/*
 * Twitch Chat X-Ray — passive WebSocket tap (MAIN world).
 * Wraps native WebSocket constructor with a Proxy.
 * Parses IRCv3 frames and posts structured JSON to the isolated content script.
 */
import { parseFrame } from './irc-parser.ts';
import { observePageBroadcasts } from './broadcast-identity.ts';
import type { BroadcastIdentity } from './broadcast-identity.ts';

type RoomState = Extract<ReturnType<typeof parseFrame>[number], { kind: 'room-state' }> & { socketId: number };
type BroadcastEvent = ({ kind: 'broadcast-identity' } & BroadcastIdentity) | { kind: 'broadcast-offline'; channel: string };

(function () {
  'use strict';

  const NativeWebSocket = window.WebSocket as typeof WebSocket & { __twitchXRayWrapped?: boolean };
  if (typeof NativeWebSocket !== 'function') {
    return;
  }

  // Guard against accidental double evaluation
  if (NativeWebSocket.__twitchXRayWrapped) {
    return;
  }

  const TARGET_URL_RE = /irc-ws\.chat\.twitch\.tv/i;
  const POST_SOURCE = 'twitch-chat-xray';
  const POST_TYPE = 'privmsg';
  const SYNC_EVENT = 'twitch-chat-xray:privmsg';
  const textDecoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;

  /*
   * Bridge authentication.
   *
   * The MAIN world is shared with Twitch and every other extension script, so
   * a plain CustomEvent on window is forgeable: any page script could post
   * fake PRIVMSGs and make the extension badge innocent users. The isolated
   * content script therefore generates a random nonce per page load and hands
   * it over in a handshake; every payload carries it and the content script
   * silently drops anything else.
   */
  const HANDSHAKE_EVENT = 'twitch-chat-xray:handshake';
  let bridgeToken: string | null = null;
  const socketRooms = new Map<number, Map<string, RoomState>>();
  let bridgeSequence = 0;
  const latestBroadcasts = new Map<string, BroadcastEvent>();

  function adoptToken(token: unknown) {
    if (typeof token === 'string' && token.length >= 16) {
      const changed = bridgeToken !== token;
      bridgeToken = token;
      if (changed) {
        postMessages([...latestBroadcasts.values()], '');
        for (const [socketId, rooms] of socketRooms) {
          postMessages([{ kind: 'socket-open', socketId }, ...rooms.values()], '');
        }
      }
    }
  }

  window.addEventListener(HANDSHAKE_EVENT, (event) => {
    try {
      const raw = 'detail' in event ? event.detail : undefined;
      const detail: unknown = JSON.parse(String(raw || '{}'));
      if (detail && typeof detail === 'object' && 'source' in detail && detail.source === POST_SOURCE &&
          'token' in detail) adoptToken(detail.token);
    } catch (_error) {
      // Malformed handshake is ignored.
    }
  });

  // The content script may have announced itself before inject.js ran.
  try {
    window.dispatchEvent(new CustomEvent(HANDSHAKE_EVENT + ':request'));
  } catch (_error) {
    // Non-fatal
  }
  const wrappedSockets = new WeakSet<WebSocket>();
  let socketSequence = 0;

  function postMessages(messages: unknown[], socketUrl: string) {
    if (!messages || messages.length === 0) {
      return;
    }

    const targetOrigin =
      window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '*';

    if (!bridgeToken) {
      // No handshake yet: drop rather than send an unauthenticated payload.
      return;
    }

    const payload = {
      source: POST_SOURCE,
      type: POST_TYPE,
      version: 1,
      token: bridgeToken,
      socketUrl: String(socketUrl || ''),
      messages,
      sequence: ++bridgeSequence,
    };

    // Synchronous bridge: the content script can score the message before
    // Twitch's own socket listener renders the row. If the isolated world does
    // not receive the CustomEvent, the postMessage below is the fallback.
    try {
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENT, { detail: JSON.stringify(payload) })
      );
    } catch (_error) {
      // CustomEvent may be unavailable in an exotic environment.
    }

    try {
      window.postMessage(payload, targetOrigin);
    } catch (_error) {
      // Page navigation in progress; drop safely
    }
  }

  function publishBroadcast(message: BroadcastEvent) {
    latestBroadcasts.delete(message.channel);
    latestBroadcasts.set(message.channel, message);
    const oldest = latestBroadcasts.keys().next().value;
    if (latestBroadcasts.size > 16 && oldest !== undefined) latestBroadcasts.delete(oldest);
    postMessages([message], '');
  }

  observePageBroadcasts(window,
    identity => publishBroadcast({ kind: 'broadcast-identity', ...identity }),
    channel => publishBroadcast({ kind: 'broadcast-offline', channel }));

  function consumeFrame(rawFrame: unknown, socketUrl: string, socketId: number) {
    if (typeof rawFrame !== 'string' || !rawFrame) {
      return;
    }

    let messages;
    try {
      messages = parseFrame(rawFrame, Date.now());
    } catch (_error) {
      return;
    }

    for (const message of messages) {
      if (!('kind' in message) || message.kind !== 'room-state') continue;
      const rooms = socketRooms.get(socketId);
      if (!rooms) continue;
      const room = Object.assign(message, { socketId });
      room.mode = { ...rooms.get(room.channel)?.mode, ...room.mode };
      rooms.set(room.channel, room);
    }
    postMessages(messages, socketUrl);
  }

  function consumeData(data: unknown, socketUrl: string, socketId: number) {
    if (typeof data === 'string') {
      consumeFrame(data, socketUrl, socketId);
      return;
    }

    if (data instanceof ArrayBuffer) {
      if (!textDecoder) {
        return;
      }
      try {
        consumeFrame(textDecoder.decode(new Uint8Array(data)), socketUrl, socketId);
      } catch (_error) {
        // Ignore malformed binary
      }
      return;
    }

    if (typeof Blob === 'function' && data instanceof Blob) {
      data
        .text()
        .then((text) => {
          consumeFrame(text, socketUrl, socketId);
        })
        .catch(() => {
          // Ignore unreadable blob
        });
    }
  }

  function attachTap(socket: WebSocket, socketUrl: string) {
    if (!socket || wrappedSockets.has(socket)) {
      return;
    }
    wrappedSockets.add(socket);

    const socketId = ++socketSequence;
    try {
      for (const kind of ['open', 'close']) {
        socket.addEventListener(kind, () => {
          if (kind === 'open') socketRooms.set(socketId, new Map());
          else socketRooms.delete(socketId);
          postMessages([{ kind: 'socket-' + kind, socketId }], socketUrl);
        });
      }
      socket.addEventListener('message', (event) => {
        consumeData(event.data, socketUrl, socketId);
      });
    } catch (_error) {
      // Socket was already closed
    }
  }

  const WrappedWebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      try {
        const socketUrl = String(args[0] == null ? '' : args[0]);
        if (TARGET_URL_RE.test(socketUrl)) {
          attachTap(socket, socketUrl);
        }
      } catch (_error) {
        // Ignore throwing URL toString
      }
      return socket;
    },
  });

  try {
    Object.defineProperty(WrappedWebSocket, '__twitchXRayWrapped', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch (_error) {
    // Non-essential marker
  }

  try {
    Object.defineProperty(window, 'WebSocket', {
      value: WrappedWebSocket,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } catch (_error) {
    try {
      window.WebSocket = WrappedWebSocket;
    } catch (_assignmentError) {
      // Last-resort fallback
    }
  }
})();
