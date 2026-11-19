const START_FIELDS = ['createdAt', 'startedAt'];

function parseStart(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    value = Date.parse(value);
  }
  if (typeof value === 'string' && /^\d{13}$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function normalizeBroadcast(channel, id, startedAt) {
  const login = String(channel ?? '').toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return null;
  const streamId = /^(?:[0-9]{1,30})$/.test(String(id ?? '')) ? String(id) : null;
  const start = parseStart(startedAt);
  return streamId || start ? { channel: login, id: streamId, startedAt: start } : null;
}

export function extractBroadcasts(body, requestBody) {
  const identities = [];
  const requests = Array.isArray(requestBody) ? requestBody : [requestBody];
  const responses = Array.isArray(body) ? body : [body];
  for (const [index, item] of responses.entries()) {
    const user = item?.data?.user ?? item?.data?.userOrError?.user ?? item?.data?.userOrError;
    const stream = user?.stream;
    if (!stream || typeof stream !== 'object') continue;
    const variables = requests[index]?.variables;
    const owner = user.login ?? stream.broadcaster?.login ?? variables?.channelLogin ?? variables?.login;
    const startedAt = START_FIELDS.map((key) => stream[key]).find((value) => value != null);
    const identity = normalizeBroadcast(owner, stream.id, startedAt);
    if (identity) identities.push(identity);
  }
  return identities;
}

export function broadcastIdentity(channel, doc = globalThis.document) {
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

export function observePageBroadcasts(page, receive) {
  if (typeof page.fetch !== 'function') return;
  page.fetch = new Proxy(page.fetch, {
    apply(target, receiver, args) {
      const request = Reflect.apply(target, receiver, args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? args[0]?.href;
      if (typeof url === 'string' &&
          (url === 'https://gql.twitch.tv/gql' || url.startsWith('https://gql.twitch.tv/gql?'))) {
        let operations;
        try {
          operations = JSON.parse(typeof args[1]?.body === 'string' ? args[1].body : 'null');
        } catch (_error) {
          // An explicit broadcaster login in the response is sufficient.
        }
        request.then((response) => {
          if (response.ok) return response.clone().json();
          return null;
        }).then((body) => {
          for (const identity of extractBroadcasts(body, operations)) receive(identity);
        }).catch(() => {});
      }
      return request;
    },
  });
}
