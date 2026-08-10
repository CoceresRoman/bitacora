import { createHash } from 'node:crypto';

export type SignalSource = 'git' | 'inbox' | 'trends';

export const SIGNAL_SOURCES: readonly SignalSource[] = ['git', 'inbox', 'trends'] as const;

export interface RawSignal {
  id: string;
  source: SignalSource;
  kind: string;
  payload: string;
  refs: string[];
  capturedAt: Date;
  hash: string;
}

export function signalHash(source: SignalSource, payload: string): string {
  return createHash('sha256').update(`${source}:${payload.trim()}`).digest('hex');
}

export function isSignalSource(value: string): value is SignalSource {
  return (SIGNAL_SOURCES as readonly string[]).includes(value);
}
