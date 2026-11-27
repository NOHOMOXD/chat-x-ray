/** Coalesce page mutations while keeping row binding and statistics independent. */
export class UiUpdateScheduler {
  private bindTimer: number | null = null;
  private statsTimer: number | null = null;

  constructor(private readonly bind: () => void, private readonly updateStats: () => void) {}

  scheduleBind(): void {
    if (this.bindTimer !== null) return;
    this.bindTimer = window.setTimeout(() => {
      this.bindTimer = null;
      this.bind();
    }, 80);
  }

  scheduleStats(): void {
    if (this.statsTimer !== null) return;
    this.statsTimer = window.setTimeout(() => {
      this.statsTimer = null;
      this.updateStats();
    }, 250);
  }

  stop(): void {
    if (this.bindTimer !== null) window.clearTimeout(this.bindTimer);
    if (this.statsTimer !== null) window.clearTimeout(this.statsTimer);
    this.bindTimer = null;
    this.statsTimer = null;
  }
}
