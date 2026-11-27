/** Owns page lifecycle subscriptions and the two periodic page checks. */
interface PageLifecycleCallbacks {
  navigate: () => void;
  maintain: () => void;
  freeze: () => void;
  resume: () => void;
  pageHide: () => void;
  hidden: () => void;
}

export class PageLifecycle {
  private navigationTimer: number | null = null;
  private maintenanceTimer: number | null = null;
  private active = false;

  constructor(private readonly callbacks: PageLifecycleCallbacks) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener('popstate', this.callbacks.navigate);
    window.addEventListener('hashchange', this.callbacks.navigate);
    document.addEventListener('freeze', this.callbacks.freeze);
    document.addEventListener('resume', this.callbacks.resume);
    window.addEventListener('pagehide', this.callbacks.pageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pageshow', this.callbacks.resume);
    this.navigationTimer = window.setInterval(this.callbacks.navigate, 250);
    this.maintenanceTimer = window.setInterval(this.callbacks.maintain, 1000);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('popstate', this.callbacks.navigate);
    window.removeEventListener('hashchange', this.callbacks.navigate);
    document.removeEventListener('freeze', this.callbacks.freeze);
    document.removeEventListener('resume', this.callbacks.resume);
    window.removeEventListener('pagehide', this.callbacks.pageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pageshow', this.callbacks.resume);
    if (this.navigationTimer !== null) window.clearInterval(this.navigationTimer);
    if (this.maintenanceTimer !== null) window.clearInterval(this.maintenanceTimer);
    this.navigationTimer = null;
    this.maintenanceTimer = null;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.callbacks.hidden();
  };
}
