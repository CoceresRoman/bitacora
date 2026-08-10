import { GRACE_WINDOW_HOURS, SchedulerService } from './scheduler.service';
import { CycleService } from './cycle.service';
import { PublishQueue } from '../publisher/publish.queue';
import { CycleLogRepository } from '../persistence/cycle-log.repository';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-08-07T10:00:00Z');

function harness(lastCycleAt: Date | null) {
  const ran: Date[] = [];
  const recorded: string[] = [];
  const cycle = {
    runCycle: async (now: Date) => {
      ran.push(now);
      return 'RAN' as const;
    },
    expireStale: async () => 0,
  } as unknown as CycleService;
  const queue = { drain: async () => undefined } as unknown as PublishQueue;
  const cycles = {
    lastCycleAt: async () => lastCycleAt,
    record: async (_at: Date, outcome: string) => {
      recorded.push(outcome);
    },
  } as unknown as CycleLogRepository;
  return { ran, recorded, service: new SchedulerService(cycle, queue, cycles) };
}

describe('SchedulerService.recoverMissedCycle', () => {
  it('runs a cycle missed inside the grace window', async () => {
    const h = harness(new Date(NOW.getTime() - (GRACE_WINDOW_HOURS - 1) * HOUR_MS));
    await h.service.recoverMissedCycle(NOW);
    expect(h.ran).toHaveLength(0);
  });

  it('runs when the last cycle is older than the cadence but inside the grace window', async () => {
    const h = harness(new Date(NOW.getTime() - 30 * HOUR_MS));
    await h.service.recoverMissedCycle(NOW, new Date(NOW.getTime() - 2 * HOUR_MS));
    expect(h.ran).toHaveLength(1);
  });

  it('does not run a cycle that was due more than the grace window ago', async () => {
    const h = harness(new Date(NOW.getTime() - 200 * HOUR_MS));
    await h.service.recoverMissedCycle(NOW, new Date(NOW.getTime() - 50 * HOUR_MS));
    expect(h.ran).toHaveLength(0);
    expect(h.recorded).toEqual(['SKIPPED_STALE']);
  });

  it('runs on a first boot with no cycle history', async () => {
    const h = harness(null);
    await h.service.recoverMissedCycle(NOW, new Date(NOW.getTime() - 2 * HOUR_MS));
    expect(h.ran).toHaveLength(1);
  });

  it('uses a twelve hour grace window', () => {
    expect(GRACE_WINDOW_HOURS).toBe(12);
  });
});

describe('SchedulerService.drainQueue', () => {
  it('drains the publish queue and expires stale drafts', async () => {
    const drained: Date[] = [];
    const expired: Date[] = [];
    const cycle = {
      runCycle: async () => 'RAN' as const,
      expireStale: async (now: Date) => {
        expired.push(now);
        return 0;
      },
    } as unknown as CycleService;
    const queue = {
      drain: async (now: Date) => {
        drained.push(now);
      },
    } as unknown as PublishQueue;
    const cycles = { lastCycleAt: async () => null, record: async () => undefined } as unknown as CycleLogRepository;
    const service = new SchedulerService(cycle, queue, cycles);

    await service.drainQueue();

    expect(drained).toHaveLength(1);
    expect(expired).toHaveLength(1);
  });
});
