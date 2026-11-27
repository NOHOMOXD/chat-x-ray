/*
 * Twitch Chat X-Ray — optional account-age lookup (unofficial GQL).
 *
 * Only active when the user turns on the "accountAgeLookup" setting. It asks
 * Twitch's public web GraphQL endpoint for `user.createdAt` of accounts that
 * already look suspicious, batches requests, caches results for the tab and
 * never blocks chat analysis. The extension remains fully local when the
 * setting is off.
 *
 * This is not an official Twitch API: the endpoint is undocumented and can
 * change or rate-limit. An unavailable date leaves the account age unknown.
 */
export const TWITCH_GQL_URL = 'https://gql.twitch.tv/gql';
// Public "web" client id used by twitch.tv itself. No user token/cookies are
// sent; the request is the same public query the web client makes.
export const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

interface AccountAgeOptions {
  getSettings?: () => { accountAgeLookup?: boolean; suspiciousThreshold?: number };
  onAge?: (login: string, ageDays: number) => void;
  onError?: (error: unknown) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  clientId?: string;
  minScore?: number;
  batchSize?: number;
  rateLimitMs?: number;
  batchDelayMs?: number;
  requestTimeoutMs?: number;
  failedRetryMs?: number;
  cacheTtlMs?: number;
  maxRequests?: number;
}

interface CacheEntry {
  ageDays: number | null;
  createdAt?: unknown;
  fetchedAt: number;
  failed: boolean;
}

function numberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export class AccountAgeService {
  private readonly getSettings: NonNullable<AccountAgeOptions['getSettings']>;
  private readonly onAge: NonNullable<AccountAgeOptions['onAge']>;
  private readonly onError: NonNullable<AccountAgeOptions['onError']>;
  private readonly fetchImpl: typeof fetch | null;
  private readonly now: () => number;
  private readonly clientId: string;
  private readonly minScore: number;
  private readonly batchSize: number;
  private readonly rateLimitMs: number;
  private readonly batchDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly failedRetryMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxRequests: number;
  private readonly cache = new Map<string, CacheEntry>();
  private queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly inFlight = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRequestAt = 0;
  private cooldownUntil = 0;
  private requests = 0;
  private flushing = false;

  constructor(options?: AccountAgeOptions) {
    const opts = options || {};
    this.getSettings = opts.getSettings || (() => ({}));
    this.onAge = opts.onAge || (() => {});
    this.onError = opts.onError || (() => {});
    this.fetchImpl =
      opts.fetchImpl ||
      (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.now = opts.now || (() => Date.now());
    this.clientId = opts.clientId || TWITCH_WEB_CLIENT_ID;
    this.minScore = numberOrDefault(opts.minScore, 30);
    this.batchSize = numberOrDefault(opts.batchSize, 8);
    this.rateLimitMs = numberOrDefault(opts.rateLimitMs, 1200);
    this.batchDelayMs = numberOrDefault(opts.batchDelayMs, 250);
    this.requestTimeoutMs = numberOrDefault(opts.requestTimeoutMs, 8000);
    this.failedRetryMs = numberOrDefault(opts.failedRetryMs, 10 * 60 * 1000);
    this.cacheTtlMs = numberOrDefault(opts.cacheTtlMs, 6 * 60 * 60 * 1000);
    this.maxRequests = numberOrDefault(opts.maxRequests, 200);
  }

  get enabled() {
    return Boolean(this.getSettings().accountAgeLookup);
  }

  maybeLookup(login: string, botScore: number, potentialPoints = 0) {
    if (!this.enabled) {
      return false;
    }
    const key = String(login || '').toLowerCase();
    if (!key || key.length > 64) {
      return false;
    }
    const threshold = Number(this.getSettings().suspiciousThreshold) || this.minScore;
    if (Number(botScore) < this.minScore && Number(botScore) + potentialPoints < threshold) {
      return false;
    }
    if (this.queued.has(key) || this.inFlight.has(key)) {
      return false;
    }
    const cached = this.cache.get(key);
    if (cached) {
      const ttl = cached.failed ? this.failedRetryMs : this.cacheTtlMs;
      if (this.now() - cached.fetchedAt < ttl) {
        return false;
      }
      this.cache.delete(key);
    }
    if (!this.fetchImpl || this.requests >= this.maxRequests) {
      return false;
    }

    this.queue.push(key);
    this.queued.add(key);
    this._schedule(this.batchDelayMs);
    return true;
  }

  clearQueue() {
    this.queue = [];
    this.queued.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resetQueue() {
    this.clearQueue();
  }

  _schedule(delay: number) {
    if (this.timer || !this.queue.length) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, Math.max(0, delay));
  }

  async flush() {
    if (this.flushing || !this.queue.length) {
      return;
    }
    if (!this.enabled) {
      this.clearQueue();
      return;
    }

    const now = this.now();
    const wait = Math.max(
      this.rateLimitMs - (now - this.lastRequestAt),
      this.cooldownUntil - now
    );
    if (wait > 0) {
      this._schedule(wait);
      return;
    }

    this.flushing = true;
    const batch = this.queue.splice(0, this.batchSize);
    for (const login of batch) {
      this.queued.delete(login);
      this.inFlight.add(login);
    }
    this.lastRequestAt = now;
    this.requests += 1;

    try {
      const result = await this._request(batch);
      const fetchedAt = this.now();
      for (const login of batch) {
        const createdAt = result[login];
        const ageDays = this._ageDays(createdAt, fetchedAt);
        if (ageDays !== null) {
          this.cache.set(login, { ageDays, createdAt, fetchedAt, failed: false });
          this.onAge(login, ageDays);
        } else {
          this.cache.set(login, { ageDays: null, fetchedAt, failed: true });
        }
      }
    } catch (error) {
      const fetchedAt = this.now();
      for (const login of batch) {
        this.cache.set(login, { ageDays: null, fetchedAt, failed: true });
      }
      this.cooldownUntil = fetchedAt + this.failedRetryMs;
      try {
        this.onError(error);
      } catch (_error) {
        // Diagnostics callback must never break the lookup path.
      }
    } finally {
      for (const login of batch) {
        this.inFlight.delete(login);
      }
      this.flushing = false;
      if (this.queue.length) {
        this._schedule(this.batchDelayMs);
      }
    }
  }

  _ageDays(createdAt: unknown, now: number) {
    if (typeof createdAt !== 'string' || !createdAt) {
      return null;
    }
    const timestamp = Date.parse(createdAt);
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    const days = (now - timestamp) / 86400000;
    if (!Number.isFinite(days) || days < 0) {
      return null;
    }
    return Math.floor(days);
  }

  async _request(logins: string[]): Promise<Record<string, unknown>> {
    const variables: Record<string, string> = {};
    const fields: string[] = [];
    logins.forEach((login, index) => {
      variables['l' + index] = login;
      fields.push(`u${index}:user(login:$l${index}){createdAt}`);
    });
    const variableDefs = logins
      .map((_login, index) => `$l${index}:String!`)
      .join(',');
    const query = `query(${variableDefs}){${fields.join(' ')}}`;

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (controller) {
      timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    }

    try {
      if (!this.fetchImpl) throw new Error('fetch unavailable');
      const response = await this.fetchImpl(TWITCH_GQL_URL, {
        method: 'POST',
        headers: {
          'Client-ID': this.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        credentials: 'omit',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response || !response.ok) {
        throw new Error('gql http ' + (response ? response.status : 'no-response'));
      }
      const payload: unknown = await response.json();
      const rawData = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
      const data = rawData && typeof rawData === 'object' ? rawData as Record<string, unknown> : {};
      const result: Record<string, unknown> = {};
      logins.forEach((login, index) => {
        const entry = data['u' + index];
        result[login] = entry && typeof entry === 'object' && 'createdAt' in entry && entry.createdAt
          ? entry.createdAt : null;
      });
      return result;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
