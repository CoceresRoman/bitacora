import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma.service';
import { DraftRepository } from './draft.repository';

// Absolute path: see signal.repository.spec.ts for why a relative `file:`
// URL would make rmSync() miss the database Prisma actually writes to.
const DB_PATH = join(process.cwd(), 'data', 'test-drafts.db');
const DATABASE_URL = `file:${DB_PATH}`;
const NOW = new Date('2026-08-04T12:00:00Z');

describe('DraftRepository', () => {
  let prisma: PrismaService;
  let repo: DraftRepository;

  beforeAll(() => {
    rmSync(DB_PATH, { force: true });
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL },
      stdio: 'ignore',
    });
    prisma = new PrismaService(DATABASE_URL);
    repo = new DraftRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(DB_PATH, { force: true });
  });

  it('creates a draft in DRAFTING with no revisions', async () => {
    const created = await repo.create({ signalId: 's1', topic: 'retry', bodyEs: 'texto' });
    expect(created.status).toBe('DRAFTING');
    expect(created.revisions).toEqual([]);
    expect(created.scheduledAt).toBeNull();
  });

  it('round-trips revisions through JSON without losing the Date type', async () => {
    const created = await repo.create({ signalId: 's2', topic: 'guard', bodyEs: 'texto' });
    const saved = await repo.save({
      ...created,
      status: 'REVISING',
      revisions: [{ feedback: 'mas corto', body: 'texto', at: NOW }],
    });
    const reloaded = await repo.findById(saved.id);
    expect(reloaded?.revisions[0].at).toBeInstanceOf(Date);
    expect(reloaded?.revisions[0].at.toISOString()).toBe(NOW.toISOString());
  });

  it('returns APPROVED drafts and due SCHEDULED drafts as publishable', async () => {
    const approved = await repo.create({ signalId: 's3', topic: 'a', bodyEs: 'b' });
    await repo.save({ ...approved, status: 'APPROVED' });

    const dueLater = await repo.create({ signalId: 's4', topic: 'c', bodyEs: 'd' });
    await repo.save({
      ...dueLater,
      status: 'SCHEDULED',
      scheduledAt: new Date('2026-08-06T09:00:00Z'),
    });

    const due = await repo.findDuePublication(NOW);
    const ids = due.map((d) => d.id);
    expect(ids).toContain(approved.id);
    expect(ids).not.toContain(dueLater.id);
  });

  it('sets the publish attempt counter directly rather than incrementing it', async () => {
    const created = await repo.create({ signalId: 's6', topic: 'lockout', bodyEs: 'texto' });
    await repo.save({ ...created, status: 'APPROVED' });

    await repo.setPublishAttempts(created.id, 3, NOW);

    const state = await repo.publishState(created.id);
    expect(state.attempts).toBe(3);
    expect(state.lastAttemptAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('lists topics from the recency window only', async () => {
    const old = await repo.create({ signalId: 's5', topic: 'topic-viejo', bodyEs: 'x' });
    await prisma.draft.update({
      where: { id: old.id },
      data: { createdAt: new Date('2026-07-01T00:00:00Z') },
    });
    const topics = await repo.recentTopics(14, NOW);
    expect(topics).not.toContain('topic-viejo');
    expect(topics).toContain('retry');
  });
});
