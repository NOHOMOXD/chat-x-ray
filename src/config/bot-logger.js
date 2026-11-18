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

  add(record) {
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
      botScore: record.botScore,
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
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `twitch-xray-audit-${channel}-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  }
}
