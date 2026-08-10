import { Inject, Injectable, Logger } from '@nestjs/common';
import { RawSignal, SignalSource } from '../core/signal.entity';
import { SOURCE_PORTS, SourcePort } from '../core/ports/source.port';
import { SignalRepository } from '../persistence/signal.repository';
import { DraftRepository } from '../persistence/draft.repository';

export const TOPIC_COOLDOWN_DAYS = 14;

const BASE_SCORE: Record<SignalSource, number> = { inbox: 100, git: 60, trends: 30 };
const SUBSTANCE_MIN_LENGTH = 120;
const TOPIC_VETO = -1000;
const SIGNIFICANT_WORD_MIN_LENGTH = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-záéíóúñ0-9]+/i)
    .filter((word) => word.length >= SIGNIFICANT_WORD_MIN_LENGTH);
}

export function scoreSignal(signal: RawSignal, recentTopics: string[], now: Date): number {
  const words = new Set(significantWords(signal.payload));
  const collides = recentTopics
    .flatMap((topic) => significantWords(topic))
    .some((word) => words.has(word));
  if (collides) return TOPIC_VETO;

  const ageMs = now.getTime() - signal.capturedAt.getTime();
  const recency = ageMs <= 2 * DAY_MS ? 20 : ageMs <= 7 * DAY_MS ? 10 : 0;
  const substance = signal.payload.length > SUBSTANCE_MIN_LENGTH ? 15 : 0;

  return BASE_SCORE[signal.source] + recency + substance;
}

@Injectable()
export class CuratorService {
  private readonly logger = new Logger(CuratorService.name);

  constructor(
    @Inject(SOURCE_PORTS) private readonly sources: SourcePort[],
    private readonly signals: SignalRepository,
    private readonly drafts: DraftRepository,
  ) {}

  async collect(since: Date): Promise<RawSignal[]> {
    const batches = await Promise.all(
      this.sources.map(async (source) => {
        try {
          return await source.collect(since);
        } catch (error) {
          this.logger.warn(`Source ${source.source} failed: ${(error as Error).message}`);
          return [];
        }
      }),
    );
    return this.signals.saveNew(batches.flat());
  }

  pickBest(candidates: RawSignal[], recentTopics: string[], now: Date): RawSignal | null {
    const ranked = candidates
      .map((signal) => ({ signal, score: scoreSignal(signal, recentTopics, now) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.signal ?? null;
  }

  async recentTopics(now: Date): Promise<string[]> {
    return this.drafts.recentTopics(TOPIC_COOLDOWN_DAYS, now);
  }

  async pendingSignals(): Promise<RawSignal[]> {
    return this.signals.findUnused();
  }
}
