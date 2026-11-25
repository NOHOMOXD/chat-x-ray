/*
 * Twitch Chat X-Ray — Bot Audit Log.
 * In-memory circular buffer recording detected bot messages when audit log
 * is enabled in settings. Provides JSON formatting and export capabilities.
 */

export class BotLogger {
  constructor(maxSize = 200) {
    this.maxSize = maxSize;
    this.records = [];
  }

  remove(id) {
    const index = this.records.findIndex(entry => entry.id === id);
    if (index >= 0) this.records.splice(index, 1);
  }

  add(record, suspicious) {
    if (!record) {
      return;
    }

    const entry = {
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

  downloadJson(channel = 'chat') {
    const json = this.getJson(true);
    downloadJson(json, 'twitch-xray-audit', channel);
  }
}

export function downloadJson(json, prefix, channel) {
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${prefix}-${channel || 'chat'}-${date}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
}
