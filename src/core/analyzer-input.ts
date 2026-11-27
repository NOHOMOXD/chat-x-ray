/** Fields required before an IRC message can enter the analysis pipeline. */
export interface AnalyzerInput {
  text: string;
  login: string;
}

export function normalizeAnalyzerInput(message: unknown): AnalyzerInput | null {
  if (typeof message !== 'object' || message === null) return null;
  const text = 'text' in message && typeof message.text === 'string' ? message.text.slice(0, 2000) : '';
  if (!text.trim()) return null;
  const login = 'login' in message ? message.login : undefined;
  const displayName = 'displayName' in message ? message.displayName : undefined;
  const normalizedLogin = String(login || displayName || '').trim().toLowerCase();
  return normalizedLogin ? { text, login: normalizedLogin } : null;
}
