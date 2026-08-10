import { Inject, Injectable, Logger } from '@nestjs/common';
import { Draft } from '../core/draft.entity';
import { PUBLISHER_PORT, PublisherPort } from '../core/ports/publisher.port';
import { REVIEW_CHANNEL_PORT, ReviewChannelPort } from '../core/ports/review-channel.port';
import { DraftRepository } from '../persistence/draft.repository';

export const BACKOFF_MINUTES = [1, 5, 25];
export const MAX_PUBLISH_ATTEMPTS = 3;

@Injectable()
export class PublishQueue {
  private readonly logger = new Logger(PublishQueue.name);

  constructor(
    private readonly drafts: DraftRepository,
    @Inject(PUBLISHER_PORT) private readonly publisher: PublisherPort,
    @Inject(REVIEW_CHANNEL_PORT) private readonly review: ReviewChannelPort,
  ) {}

  async drain(now: Date): Promise<void> {
    const due = await this.drafts.findDuePublication(now);
    for (const draft of due) {
      if (draft.publishedUrn) continue;

      const { attempts, lastAttemptAt } = await this.drafts.publishState(draft.id);
      if (attempts >= MAX_PUBLISH_ATTEMPTS) continue;
      if (lastAttemptAt && !this.backoffElapsed(attempts, lastAttemptAt, now)) continue;

      await this.publishOne(draft, now);
    }
  }

  private backoffElapsed(attempts: number, lastAttemptAt: Date, now: Date): boolean {
    const waitMs = this.backoffMinutes(attempts - 1) * 60 * 1000;
    return now.getTime() - lastAttemptAt.getTime() >= waitMs;
  }

  private async publishOne(draft: Draft, now: Date): Promise<void> {
    let urn: string;
    try {
      ({ urn } = await this.publisher.publish(draft.bodyEs));
    } catch (error) {
      await this.recordFailedAttempt(draft, now, (error as Error).message);
      return;
    }

    // LinkedIn already has the post at this point: nothing past this line
    // may be treated as a publish failure, or the next drain would call
    // publisher.publish() again and post the identical text a second time.
    // Persisting the URN is the very next statement, and if that
    // persistence itself throws (e.g. an ordinary SQLite lock or disk
    // error), the draft is taken out of the retry loop entirely instead of
    // being retried like a normal publish failure.
    try {
      await this.drafts.save({ ...draft, status: 'PUBLISHED', publishedUrn: urn, updatedAt: now });
      this.logger.log(`Published draft ${draft.id} as ${urn}`);
    } catch (error) {
      await this.lockOutAfterUnrecordedPublish(draft, urn, now, (error as Error).message);
    }
  }

  private async recordFailedAttempt(draft: Draft, now: Date, message: string): Promise<void> {
    const { attempts } = await this.drafts.incrementAttempts(draft.id, now);
    this.logger.warn(`Publish attempt ${attempts} for ${draft.id} failed: ${message}`);

    if (attempts >= MAX_PUBLISH_ATTEMPTS) {
      await this.review.notify(
        `No pude publicar el draft ${draft.id} después de ${attempts} intentos.\nÚltimo error: ${message}`,
      );
    }
  }

  private async lockOutAfterUnrecordedPublish(
    draft: Draft,
    urn: string,
    now: Date,
    message: string,
  ): Promise<void> {
    this.logger.error(
      `Draft ${draft.id} was published to LinkedIn as ${urn} but persisting that failed: ${message}`,
    );
    try {
      await this.drafts.setPublishAttempts(draft.id, MAX_PUBLISH_ATTEMPTS, now);
    } catch (lockError) {
      this.logger.error(
        `Also failed to lock draft ${draft.id} out of retries: ${(lockError as Error).message}`,
      );
    }
    await this.review.notify(
      `Publiqué el draft ${draft.id} en LinkedIn (${urn}) pero no pude guardarlo en la base de ` +
        `datos. Revisalo a mano para evitar publicarlo de nuevo.\nError: ${message}`,
    );
  }

  /** Minutes to wait before the next attempt. Consumed by drain() and the scheduler. */
  backoffMinutes(attempts: number): number {
    return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
  }
}
