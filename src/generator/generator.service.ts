import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PORT, LlmPort } from '../core/ports/llm.port';
import { RawSignal } from '../core/signal.entity';
import { Draft } from '../core/draft.entity';
import { DraftRepository } from '../persistence/draft.repository';
import { buildPrompt } from './prompt.builder';
import { checkStyle, StyleViolation } from './style.guard';

export const VOICE_PROFILE = Symbol('VoiceProfile');

const TOPIC_MAX_LENGTH = 120;

@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name);

  /** Violations of the body that was finally stored. Empty when the guard passed. */
  lastViolations: StyleViolation[] = [];

  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    private readonly drafts: DraftRepository,
    @Inject(VOICE_PROFILE) private readonly voiceProfile: string,
  ) {}

  async generateFor(signal: RawSignal): Promise<Draft> {
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

    this.lastViolations = violations;

    const created = await this.drafts.create({
      signalId: signal.id,
      topic: signal.payload.split('\n')[0].slice(0, TOPIC_MAX_LENGTH),
      bodyEs: body,
    });
    return this.drafts.save({ ...created, bodyEs: body, status: 'PENDING_REVIEW' });
  }

  async regenerate(draft: Draft, feedback: string): Promise<Draft> {
    const signal: RawSignal = {
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

    this.lastViolations = checkStyle(body, []);
    return this.drafts.save({ ...draft, bodyEs: body, status: 'PENDING_REVIEW' });
  }
}
