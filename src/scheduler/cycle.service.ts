import { Inject, Injectable, Logger } from '@nestjs/common';
import { applyDecision, Decision, Draft, DraftStatus } from '../core/draft.entity';
import { REVIEW_CHANNEL_PORT, ReviewChannelPort } from '../core/ports/review-channel.port';
import { CuratorService } from '../curator/curator.service';
import { GeneratorService } from '../generator/generator.service';
import { SignalRepository } from '../persistence/signal.repository';
import { DraftRepository } from '../persistence/draft.repository';
import { CycleLogRepository, CycleOutcome } from '../persistence/cycle-log.repository';
import { TokenStore } from '../publisher/linkedin/token.store';

const LOOKBACK_DAYS = 7;

/**
 * Spanish description of each draft status, for the message sent when a
 * decision arrives for a draft that can no longer take it (e.g. the owner
 * taps "Aprobar" on a draft the 5-minute sweep already marked EXPIRED).
 */
const STATUS_ES: Record<DraftStatus, string> = {
  DRAFTING: 'en borrador',
  PENDING_REVIEW: 'pendiente de revisión',
  REVISING: 'en reescritura',
  APPROVED: 'aprobado',
  SCHEDULED: 'programado',
  PUBLISHED: 'publicado',
  DISCARDED: 'descartado',
  EXPIRED: 'vencido',
};

@Injectable()
export class CycleService {
  private readonly logger = new Logger(CycleService.name);

  constructor(
    private readonly curator: CuratorService,
    private readonly generator: GeneratorService,
    @Inject(REVIEW_CHANNEL_PORT) private readonly review: ReviewChannelPort,
    private readonly drafts: DraftRepository,
    private readonly signals: SignalRepository,
    private readonly cycles: CycleLogRepository,
    private readonly tokens: TokenStore,
  ) {}

  async runCycle(now: Date): Promise<CycleOutcome> {
    if (await this.tokens.needsReauth(now)) {
      await this.review.notify(
        'Hay que reconectar LinkedIn: abrí http://localhost:3000/auth/linkedin',
      );
    }

    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    await this.curator.collect(since);

    // Score every unused signal, not only what this run captured: an idea
    // sent on Tuesday is still eligible on Friday, rather than being dropped
    // because it did not arrive during this run.
    const pool = await this.curator.pendingSignals();
    const recentTopics = await this.curator.recentTopics(now);
    const best = this.curator.pickBest(pool, recentTopics, now);

    if (!best) {
      await this.review.notify(
        'Ciclo sin material: no hubo ningún hecho nuevo que valga un post. No publico relleno.',
      );
      await this.cycles.record(now, 'SKIPPED_NO_MATERIAL');
      return 'SKIPPED_NO_MATERIAL';
    }

    const { draft, violations } = await this.generator.generateFor(best);

    try {
      await this.review.sendForReview(draft);
    } catch (error) {
      // The signal must not be consumed and the cycle must not be recorded
      // as RAN when the owner never actually received the draft:
      // markUsed() would make recoverMissedCycle skip this signal forever,
      // and the persisted PENDING_REVIEW draft would just expire 48h later
      // with nobody having seen it.
      this.logger.error(
        `Failed to send draft ${draft.id} for review, signal ${best.id} left unused: ${(error as Error).message}`,
      );
      await this.cycles.record(now, 'SEND_FAILED');
      return 'SEND_FAILED';
    }

    await this.signals.markUsed(best.id);

    if (violations.length > 0) {
      await this.review.notify(
        `Ojo: el borrador quedó con violaciones de estilo: ${violations
          .map((violation) => `${violation.rule} (${violation.detail})`)
          .join(', ')}`,
      );
    }

    await this.cycles.record(now, 'RAN');
    return 'RAN';
  }

  async handleDecision(draftId: string, decision: Decision, now: Date): Promise<void> {
    const draft = await this.drafts.findById(draftId);
    if (!draft) {
      this.logger.warn(`Decision for unknown draft ${draftId}`);
      return;
    }

    let updated: Draft;
    try {
      updated = applyDecision(draft, decision, now);
    } catch (error) {
      // The buttons on an old Telegram message are never removed, so a tap
      // can arrive for a draft the 5-minute sweep already expired (or that
      // moved on some other way) after the message was sent. Telling the
      // owner the real current state beats letting this throw bubble up to
      // the poll loop's generic catch, which would just log it and leave
      // the owner thinking the callback's "Aprobado"/"Descartado" toast
      // actually did something.
      this.logger.warn(
        `Ignoring ${decision.kind} for draft ${draftId} in status ${draft.status}: ${(error as Error).message}`,
      );
      await this.review.notify(
        `Ese borrador ya no admite esa acción — está ${STATUS_ES[draft.status]}. No se aplicó ningún cambio.`,
      );
      return;
    }
    await this.drafts.save(updated);

    if (decision.kind === 'revise') {
      const { draft: regenerated } = await this.generator.regenerate(updated, decision.feedback);
      await this.review.sendForReview(regenerated);
    }
  }

  async expireStale(now: Date): Promise<number> {
    const stale = await this.drafts.findExpirable(now);
    for (const draft of stale) {
      await this.drafts.save({ ...draft, status: 'EXPIRED', updatedAt: now });
    }
    if (stale.length > 0) {
      await this.review.notify(`Vencieron ${stale.length} borrador(es) sin respuesta. No se publican.`);
    }
    return stale.length;
  }
}
