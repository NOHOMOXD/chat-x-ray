import { SettingsRepository } from '../config/settings.ts';
import { ChatXRayApp } from './app-controller.ts';

declare global {
  interface Window {
    __twitchXRayContentBooted?: boolean;
    __twitchXRayApp?: ChatXRayApp;
  }
}

function boot(): void {
  if (!document.documentElement) {
    window.setTimeout(boot, 25);
    return;
  }
  const app = new ChatXRayApp(new SettingsRepository());
  app.start();
  window.__twitchXRayApp = app;
}

if (typeof window !== 'undefined' && !window.__twitchXRayContentBooted) {
  window.__twitchXRayContentBooted = true;
  boot();
}
