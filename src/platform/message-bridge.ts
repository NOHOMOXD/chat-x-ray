const POST_SOURCE = 'twitch-chat-xray';
const POST_TYPE = 'privmsg';
const SYNC_EVENT = 'twitch-chat-xray:privmsg';
const HANDSHAKE_EVENT = 'twitch-chat-xray:handshake';

export interface BridgePayload {
  source: string;
  type: string;
  token: string;
  messages: unknown[];
  sequence?: number;
}

function createBridgeToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export class MessageBridge {
  private readonly token = createBridgeToken();
  private lastSequence = 0;
  private started = false;

  constructor(private readonly receive: (payload: BridgePayload) => void) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('message', this.onMessage);
    window.addEventListener(SYNC_EVENT, this.onSync);
    window.addEventListener(HANDSHAKE_EVENT + ':request', this.announce);
    this.announce();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener(SYNC_EVENT, this.onSync);
    window.removeEventListener(HANDSHAKE_EVENT + ':request', this.announce);
  }

  private announce = (): void => {
    try {
      window.dispatchEvent(new CustomEvent(HANDSHAKE_EVENT, {
        detail: JSON.stringify({ source: POST_SOURCE, token: this.token }),
      }));
    } catch (_error) {
      // Without CustomEvent the MAIN-world tap cannot receive the token.
    }
  };

  private onMessage = (event: MessageEvent): void => {
    if (event.source === window) this.accept(event.data);
  };

  private onSync = (event: Event): void => {
    if (!('detail' in event) || typeof event.detail !== 'string') return;
    let data: unknown;
    try {
      data = JSON.parse(event.detail) as unknown;
    } catch (_error) {
      return;
    }
    this.accept(data);
  };

  private accept(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    if (!('source' in data) || data.source !== POST_SOURCE ||
        !('type' in data) || data.type !== POST_TYPE ||
        !('token' in data) || data.token !== this.token ||
        !('version' in data) || data.version !== 1 ||
        !('messages' in data) || !Array.isArray(data.messages) ||
        !('sequence' in data) || typeof data.sequence !== 'number' ||
        !Number.isSafeInteger(data.sequence) || data.sequence <= this.lastSequence) return;
    this.lastSequence = data.sequence;
    this.receive({ source: POST_SOURCE, type: POST_TYPE, token: this.token, messages: data.messages });
  }
}

/** Other IRC fields remain unknown until their consumer validates them. */
export interface ChatPayload extends Record<string, unknown> {
  text: string;
  login: string;
}

/** Validate the minimum fields needed to analyze a chat message. */
export function isValidChatPayload(message: unknown): message is ChatPayload {
  return typeof message === 'object' && message !== null &&
    'text' in message && typeof message.text === 'string' &&
    'login' in message && typeof message.login === 'string' &&
    message.text.length > 0 && message.text.length <= 2000 &&
    (!('channel' in message) || typeof message.channel === 'string' && /^[a-z0-9_]{1,25}$/i.test(message.channel));
}
