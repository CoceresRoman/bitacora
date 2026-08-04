import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CycleService } from './cycle.service';
import { PublishQueue } from '../publisher/publish.queue';
import { CycleLogRepository } from '../persistence/cycle-log.repository';

export const GRACE_WINDOW_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;
const CYCLE_HOUR = 8;
const CYCLE_DAYS = [1, 3, 5]; // Monday, Wednesday, Friday
const DAYS_TO_SEARCH_BACK = 8;

/** Most recent scheduled slot at or before `now`. */
export function lastScheduledSlot(now: Date): Date {
  const slot = new Date(now);
  slot.setHours(CYCLE_HOUR, 0, 0, 0);
  for (let back = 0; back < DAYS_TO_SEARCH_BACK; back++) {
    const candidate = new Date(slot);
    candidate.setDate(slot.getDate() - back);
    if (CYCLE_DAYS.includes(candidate.getDay()) && candidate <= now) return candidate;
  }
  return slot;
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly cycle: CycleService,
    private readonly queue: PublishQueue,
    private readonly cycles: CycleLogRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverMissedCycle(new Date());
  }

  @Cron('0 8 * * 1,3,5')
  async scheduledCycle(): Promise<void> {
    await this.cycle.runCycle(new Date());
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async drainQueue(): Promise<void> {
    const now = new Date();
    await this.queue.drain(now);
    await this.cycle.expireStale(now);
  }

  /**
   * Runs the most recently scheduled cycle if it never ran, but only when it
   * is still within the grace window. Switching the machine on Friday must
   * not fire Monday's and Wednesday's cycles — those are recorded
   * SKIPPED_STALE and never run.
   */
  async recoverMissedCycle(now: Date, slot: Date = lastScheduledSlot(now)): Promise<void> {
    const last = await this.cycles.lastCycleAt();
    if (last && last >= slot) {
      this.logger.log('Latest scheduled cycle already ran');
      return;
    }

    const ageMs = now.getTime() - slot.getTime();
    if (ageMs > GRACE_WINDOW_HOURS * HOUR_MS) {
      this.logger.log(`Missed cycle from ${slot.toISOString()} is stale, skipping`);
      await this.cycles.record(now, 'SKIPPED_STALE');
      return;
    }

    this.logger.log(`Recovering missed cycle from ${slot.toISOString()}`);
    await this.cycle.runCycle(now);
  }
}
