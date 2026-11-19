/*
 * Twitch Chat X-Ray — passive WebSocket tap (MAIN world).
 * Wraps native WebSocket constructor with a Proxy.
 * Parses IRCv3 frames and posts structured JSON to the isolated content script.
 */
import { parseFrame } from './irc-parser.js';

(function () {
  'use strict';

  const NativeWebSocket = window.WebSocket;
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
  let bridgeToken = null;

  function adoptToken(token) {
    if (typeof token === 'string' && token.length >= 16) {
      bridgeToken = token;
    }
  }

  window.addEventListener(HANDSHAKE_EVENT, (event) => {
    try {
      const detail = JSON.parse(String(event.detail || '{}'));
      if (detail && detail.source === POST_SOURCE) {
        adoptToken(detail.token);
      }
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
  const wrappedSockets = new WeakSet();
  let socketSequence = 0;

  function postMessages(messages, socketUrl) {
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

  function consumeFrame(rawFrame, socketUrl) {
    if (typeof rawFrame !== 'string' || !rawFrame) {
      return;
    }

    let messages;
    try {
      messages = parseFrame(rawFrame, Date.now());
    } catch (_error) {
      return;
    }

    postMessages(messages, socketUrl);
  }

  function consumeData(data, socketUrl) {
    if (typeof data === 'string') {
      consumeFrame(data, socketUrl);
      return;
    }

    if (data instanceof ArrayBuffer) {
      if (!textDecoder) {
        return;
      }
      try {
        consumeFrame(textDecoder.decode(new Uint8Array(data)), socketUrl);
      } catch (_error) {
        // Ignore malformed binary
      }
      return;
    }

    if (typeof Blob === 'function' && data instanceof Blob) {
      data
        .text()
        .then((text) => {
          consumeFrame(text, socketUrl);
        })
        .catch(() => {
          // Ignore unreadable blob
        });
    }
  }

  function attachTap(socket, socketUrl) {
    if (!socket || wrappedSockets.has(socket)) {
      return;
    }
    wrappedSockets.add(socket);

    const socketId = ++socketSequence;
    try {
      for (const kind of ['open', 'close']) {
        socket.addEventListener(kind, () => {
          postMessages([{ kind: 'socket-' + kind, socketId }], socketUrl);
        });
      }
      socket.addEventListener('message', (event) => {
        consumeData(event.data, socketUrl);
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
