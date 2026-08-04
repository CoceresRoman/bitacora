import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma.service';
import { SignalRepository } from './signal.repository';
import { RawSignal, signalHash } from '../core/signal.entity';

// Absolute path: Prisma resolves relative sqlite `file:` URLs relative to
// prisma/schema.prisma's directory, not process.cwd(), both for the CLI
// (`prisma db push`) and the generated client. A relative path here would
// make this file's rmSync() target a different location than the one
// Prisma actually writes to, leaking state across test runs.
const DB_PATH = join(process.cwd(), 'data', 'test-signals.db');
const DATABASE_URL = `file:${DB_PATH}`;

function signal(payload: string): RawSignal {
  return {
    id: '',
    source: 'git',
    kind: 'commit',
    payload,
    refs: ['https://github.com/CoceresRoman/bitacora/commit/abc'],
    capturedAt: new Date('2026-08-04T10:00:00Z'),
    hash: signalHash('git', payload),
  };
}

describe('SignalRepository', () => {
  let prisma: PrismaService;
  let repo: SignalRepository;

  beforeAll(() => {
    rmSync(DB_PATH, { force: true });
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL },
      stdio: 'ignore',
    });
    prisma = new PrismaService(DATABASE_URL);
    repo = new SignalRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(DB_PATH, { force: true });
  });

  it('inserts unseen signals and returns them', async () => {
    const inserted = await repo.saveNew([signal('fix retry backoff')]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].id).not.toBe('');
    expect(inserted[0].refs).toEqual(['https://github.com/CoceresRoman/bitacora/commit/abc']);
  });

  it('skips a signal whose hash was already stored', async () => {
    const inserted = await repo.saveNew([signal('fix retry backoff')]);
    expect(inserted).toHaveLength(0);
  });

  it('excludes used signals from findUnused', async () => {
    const [fresh] = await repo.saveNew([signal('add style guard')]);
    await repo.markUsed(fresh.id);
    const unused = await repo.findUnused();
    expect(unused.map((s) => s.id)).not.toContain(fresh.id);
  });

  it('finds a signal by id', async () => {
    const [fresh] = await repo.saveNew([signal('findById target')]);
    const found = await repo.findById(fresh.id);
    expect(found?.id).toBe(fresh.id);
    expect(found?.payload).toBe('findById target');
  });

  it('returns null when the signal id does not exist', async () => {
    const found = await repo.findById('nonexistent-id');
    expect(found).toBeNull();
  });
});
