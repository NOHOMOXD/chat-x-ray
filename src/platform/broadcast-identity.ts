const START_FIELDS = ['createdAt', 'startedAt'];

export interface BroadcastIdentity { channel: string; id: string | null; startedAt: number | null; }

export interface TwitchPage { fetch: typeof fetch; location?: Pick<Location, 'href'>; }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function parseStart(value: unknown) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    value = Date.parse(value);
  }
  if (typeof value === 'string' && /^\d{13}$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function normalizeBroadcast(channel: unknown, id: unknown, startedAt: unknown): BroadcastIdentity | null {
  const login = String(channel ?? '').toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return null;
  const streamId = /^(?:[0-9]{1,30})$/.test(String(id ?? '')) ? String(id) : null;
  const start = parseStart(startedAt);
  return streamId || start ? { channel: login, id: streamId, startedAt: start } : null;
}

export function extractBroadcasts(body: unknown, requestBody: unknown, receiveOffline?: (channel: string) => void) {
  const identities = [];
  const requests = Array.isArray(requestBody) ? requestBody : [requestBody];
  const responses = Array.isArray(body) ? body : [body];
  for (const [index, item] of responses.entries()) {
    const data = asRecord(asRecord(item)?.data);
    const userOrError = asRecord(data?.userOrError);
    const user = asRecord(data?.user ?? userOrError?.user ?? userOrError);
    const stream = user?.stream;
    const streamData = asRecord(stream);
    const variables = asRecord(asRecord(requests[index])?.variables);
    const owner = user?.login ?? asRecord(streamData?.broadcaster)?.login ?? variables?.channelLogin ?? variables?.login;
    if (stream === null && typeof owner === 'string' && /^[a-z0-9_]{1,25}$/i.test(owner)) receiveOffline?.(owner.toLowerCase());
    if (!stream || typeof stream !== 'object') continue;
    if (!streamData) continue;
    const startedAt = START_FIELDS.map((key) => streamData[key]).find((value) => value != null);
    const identity = normalizeBroadcast(owner, streamData.id, startedAt);
    if (identity) identities.push(identity);
  }
  return identities;
}

export function broadcastIdentity(channel: string, doc: Document | undefined = globalThis.document) {
  // A relative uptime shown by the player is rounded and cannot be used as a
  // stable ID across tabs. Accept only an explicit ID or absolute start time.
  const nodes = doc?.querySelectorAll('[data-stream-id], [data-stream-started-at]') ?? [];
  for (const node of nodes) {
    const login = node.getAttribute('data-channel-login') ??
      node.closest('[data-channel-login]')?.getAttribute('data-channel-login');
    if (login?.toLowerCase() !== channel?.toLowerCase()) continue;
    const identity = normalizeBroadcast(login, node.getAttribute('data-stream-id'),
      node.getAttribute('data-stream-started-at'));
    if (identity) return identity;
  }
  return null;
}

export function observePageBroadcasts(page: TwitchPage, receive: (identity: BroadcastIdentity) => void, receiveOffline?: (channel: string) => void) {
  if (typeof page.fetch !== 'function') return;
  page.fetch = new Proxy(page.fetch, {
    apply(target, receiver, args) {
      const request = Reflect.apply(target, receiver, args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? args[0]?.href;
      let endpoint;
      try { endpoint = new URL(url, page.location?.href); } catch { return request; }
      if (endpoint.origin === 'https://gql.twitch.tv' && endpoint.pathname === '/gql') {
        let operations: unknown;
        try {
          operations = JSON.parse(typeof args[1]?.body === 'string' ? args[1].body : 'null');
        } catch (_error) {
          // An explicit broadcaster login in the response is sufficient.
        }
        request.then((response: Response) => {
          if (response.ok) return response.clone().json();
          return null;
        }).then((body: unknown) => {
          for (const identity of extractBroadcasts(body, operations, receiveOffline)) receive(identity);
        }).catch(() => {});
      }
      return request;
    },
  });
}
