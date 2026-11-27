/*
 * Twitch Chat X-Ray — Bot Audit Log.
 * In-memory circular buffer recording detected bot messages when audit log
 * is enabled in settings. Provides JSON formatting and export capabilities.
 */

interface AuditTrigger {
  key: string;
}

interface AuditSource {
  id: string;
  ts: number;
  channel?: string;
  userId?: string | number | null;
  numericUserId?: number | null;
  login: string;
  displayName?: string;
  text: string;
  botScore: number;
  triggers?: AuditTrigger[];
  isR9KDuplicate?: boolean;
  spamFlood?: boolean;
  accountAgeDays?: number | null;
  r9kSimilarity?: number;
  color?: string;
  badges?: string[];
  freshAccount?: boolean;
  solicitation?: boolean;
  clusterPeers?: number;
}

type AuditEntry = ReturnType<typeof makeAuditEntry>;

function makeAuditEntry(record: AuditSource, suspicious: boolean) {
  return {
    id: record.id,
    timestamp: record.ts,
    isoTime: new Date(record.ts).toISOString(),
    channel: record.channel || '',
    userId: record.userId || record.numericUserId || null,
    login: record.login,
    displayName: record.displayName || record.login,
    text: record.text,
    botScore: record.botScore, suspicious,
    triggers: record.triggers ? [...record.triggers] : [],
    // Flat key list makes dumps easy to filter: `sterile-text`,
    // `mechanical-rhythm`, `fresh-account`, `id-cluster`, ...
    triggerKeys: record.triggers
      ? record.triggers.map((trigger) => trigger.key)
      : [],
    isR9KDuplicate: Boolean(record.isR9KDuplicate),
    spamFlood: Boolean(record.spamFlood),
    accountAgeDays: Number.isFinite(record.accountAgeDays)
      ? record.accountAgeDays
      : null,
    r9kSimilarity: record.r9kSimilarity || 0,
    color: record.color || '',
    badges: record.badges ? [...record.badges] : [],
    freshAccount: Boolean(record.freshAccount),
    solicitation: Boolean(record.solicitation),
    clusterPeers: Number.isFinite(record.clusterPeers)
      ? record.clusterPeers
      : 0,
  };
}

export class BotLogger {
  private records: AuditEntry[] = [];

  constructor(private readonly maxSize = 200) {}

  remove(id: string) {
    const index = this.records.findIndex(entry => entry.id === id);
    if (index >= 0) this.records.splice(index, 1);
  }

  add(record: AuditSource | null, suspicious: boolean) {
    if (!record) {
      return;
    }

    const entry = makeAuditEntry(record, suspicious);

    const existing = this.records.findIndex(item => item.id === record.id);
    if (existing >= 0) {
      this.records[existing] = entry;
      return;
    }
    this.records.push(entry);
    if (this.records.length > this.maxSize) {
      this.records.shift();
    }
  }

  getRecords() {
    return [...this.records];
  }

  count() {
    return this.records.length;
  }

  clear() {
    this.records = [];
  }

  getJson(pretty = true) {
    return JSON.stringify(this.records, null, pretty ? 2 : 0);
  }
}
