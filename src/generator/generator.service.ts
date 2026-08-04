import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PORT, LlmPort } from '../core/ports/llm.port';
import { RawSignal } from '../core/signal.entity';
import { Draft } from '../core/draft.entity';
import { DraftRepository } from '../persistence/draft.repository';
import { SignalRepository } from '../persistence/signal.repository';
import { buildPrompt } from './prompt.builder';
import { checkStyle, StyleViolation } from './style.guard';

export const VOICE_PROFILE = Symbol('VoiceProfile');

const TOPIC_MAX_LENGTH = 120;

/**
 * Result of a generation attempt: the persisted draft plus the style-guard
 * violations of the body that was finally stored (empty when the guard
 * passed). Returned rather than stashed on the instance, because
 * GeneratorService is a singleton provider — two concurrent calls (e.g. a
 * scheduled cycle and a revision arriving from Telegram) would otherwise
 * overwrite each other's violations before either caller could read them.
 */
export interface GeneratedDraft {
  draft: Draft;
  violations: StyleViolation[];
}

@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name);

  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    private readonly drafts: DraftRepository,
    private readonly signals: SignalRepository,
    @Inject(VOICE_PROFILE) private readonly voiceProfile: string,
  ) {}

  async generateFor(signal: RawSignal): Promise<GeneratedDraft> {
    const first = (await this.llm.generate(buildPrompt({ signal, voiceProfile: this.voiceProfile })))
      .trim();
    let body = first;
    let violations = checkStyle(body, signal.refs);

    if (violations.length > 0) {
      this.logger.warn(`Style guard failed, retrying once: ${violations.map((v) => v.rule).join(', ')}`);
      body = (
        await this.llm.generate(
          buildPrompt({ signal, voiceProfile: this.voiceProfile, previousBody: first, violations }),
        )
      ).trim();
      violations = checkStyle(body, signal.refs);
    }

    const created = await this.drafts.create({
      signalId: signal.id,
      topic: signal.payload.split('\n')[0].slice(0, TOPIC_MAX_LENGTH),
      bodyEs: body,
    });
    const draft = await this.drafts.save({ ...created, bodyEs: body, status: 'PENDING_REVIEW' });
    return { draft, violations };
  }

  async regenerate(draft: Draft, feedback: string): Promise<GeneratedDraft> {
    const originalSignal = await this.signals.findById(draft.signalId);

    // The original signal is the source of truth for the refs the style
    // guard must anchor to. Falling back to a synthetic signal (refs: [])
    // only when the original is genuinely gone (e.g. purged) — never
    // silently on a lookup we could have satisfied, since a synthetic
    // signal with no refs lets `missing-reference` collapse into "does the
    // body contain any digit", trivially satisfied by a fabricated number.
    const signal: RawSignal = originalSignal ?? {
      id: draft.signalId,
      source: 'git',
      kind: 'revision',
      payload: draft.topic,
      refs: [],
      capturedAt: draft.createdAt,
      hash: '',
    };

    const body = (
      await this.llm.generate(
        buildPrompt({
          signal,
          voiceProfile: this.voiceProfile,
          previousBody: draft.bodyEs,
          feedback,
        }),
      )
    ).trim();

    const violations = checkStyle(body, signal.refs);
    const saved = await this.drafts.save({ ...draft, bodyEs: body, status: 'PENDING_REVIEW' });
    return { draft: saved, violations };
  }
}
