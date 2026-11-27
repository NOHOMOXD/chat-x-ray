import type { ChatRecord } from './chat-session.ts';

export interface AnalysisTrigger {
  key: string;
  points: number;
  labelKey?: string;
  label?: string;
  labelParams?: { days: number | undefined };
  peers?: number;
}

export interface BotConfirmation {
  ts: number;
  score: number;
  triggers: AnalysisTrigger[];
}

/** One accepted message, shared by the session, wave tracker and UI. */
export interface AnalyzerRecord extends ChatRecord {
  command: string | null;
  receivedAt: number;
  sequence: number;
  serverTimestamp: boolean;
  channel: string;
  userId: number | null;
  numericUserId: number | null;
  login: string;
  displayName: string;
  badges: string[];
  color: string;
  firstMsg: boolean;
  text: string;
  normalized: string;
  unbadged: boolean;
  roleExempt: boolean;
  serviceBot: boolean;
  freshAccount: boolean;
  solicitation: boolean;
  accountAgeDays: number | null;
  accountAgeSource: 'api' | null;
  clusterPeers: number;
  spamFlood: boolean;
  botScore: number;
  triggers: AnalysisTrigger[];
  isR9KDuplicate: boolean;
  r9kSimilarity: number;
  r9kMatchId: string | null;
  selfSimilarity: number;
  bucketStart: number;
  waveBoost: boolean;
  botConfirmation?: BotConfirmation;
}

export interface ChatWaveEvent {
  [field: string]: unknown;
  kind: 'chat-wave';
  ts: number;
  bucketStart: number;
  messages: number;
  authors: number;
  atTrigger?: unknown;
}
