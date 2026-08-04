import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../src/persistence/prisma.service';
import { SignalRepository } from '../../src/persistence/signal.repository';
import { DraftRepository } from '../../src/persistence/draft.repository';
import { CycleLogRepository } from '../../src/persistence/cycle-log.repository';
import { CuratorService } from '../../src/curator/curator.service';
import { GeneratorService } from '../../src/generator/generator.service';
import { CycleService } from '../../src/scheduler/cycle.service';
import { PublishQueue } from '../../src/publisher/publish.queue';
import { TokenStore } from '../../src/publisher/linkedin/token.store';
import { SourcePort } from '../../src/core/ports/source.port';
import { LlmPort } from '../../src/core/ports/llm.port';
import { PublisherPort } from '../../src/core/ports/publisher.port';
import { ReviewChannelPort, DecisionHandler } from '../../src/core/ports/review-channel.port';
import { Draft } from '../../src/core/draft.entity';
import { signalHash } from '../../src/core/signal.entity';

// Absolute path: Prisma resolves relative sqlite `file:` URLs relative to
// prisma/schema.prisma's directory, not process.cwd(), both for the CLI
// (`prisma db push`) and the generated client. A relative path here would
// make rmSync() target a different location than the one Prisma actually
// writes to, leaking rows across test runs. Same pattern as
// src/persistence/signal.repository.spec.ts.
const DB_PATH = join(process.cwd(), 'data', 'test-e2e.db');
const DATABASE_URL = `file:${DB_PATH}`;
const KEY = 'e'.repeat(64);
const NOW = new Date('2026-08-04T08:00:00Z');

const POST = `Rompí la cola de publicación en bitacora@abc123 con un retry de 1 segundo fijo.

Con LinkedIn devolviendo 429, tres reintentos en tres segundos son tres 429 más. Cambié a backoff exponencial de 1, 5 y 25 minutos y guardo el contador de intentos en la fila del draft, no en memoria: si el proceso muere entre reintentos, al arrancar sabe en qué intento iba.

Tres intentos y avisa. Después decide un humano.`;

describe('full cycle', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    rmSync(DB_PATH, { force: true });
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL },
      stdio: 'ignore',
    });
    prisma = new PrismaService(DATABASE_URL);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(DB_PATH, { force: true });
  });

  it('goes from a git signal to a published post, gated by approval', async () => {
    const signals = new SignalRepository(prisma);
    const drafts = new DraftRepository(prisma);
    const cycles = new CycleLogRepository(prisma);

    const payload = 'feat: backoff exponencial en la cola de publicación';
    const gitSource: SourcePort = {
      source: 'git',
      collect: async () => [
        {
          id: '',
          source: 'git',
          kind: 'commit',
          payload,
          refs: ['bitacora@abc123'],
          capturedAt: NOW,
          hash: signalHash('git', payload),
        },
      ],
    };

    const llm: LlmPort = { generate: async () => POST };
    const curator = new CuratorService([gitSource], signals, drafts);
    // GeneratorService's real constructor order is (llm, drafts, signals,
    // voiceProfile) — see src/generator/generator.service.ts. The original
    // task brief had this as (llm, drafts, voiceProfile), which does not
    // match the merged code.
    const generator = new GeneratorService(llm, drafts, signals, '# Perfil de voz');

    const reviewed: Draft[] = [];
    let handler: DecisionHandler = async () => undefined;
    const review: ReviewChannelPort = {
      sendForReview: async (draft) => {
        reviewed.push(draft);
      },
      notify: async () => undefined,
      onDecision: (fn) => {
        handler = fn;
      },
    };

    const tokens = new TokenStore(prisma, KEY);
    await tokens.save({
      accessToken: 'AQX-token',
      memberUrn: 'urn:li:person:abc',
      expiresAt: new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000),
    });

    const publisher: PublisherPort = { publish: async () => ({ urn: 'urn:li:share:e2e' }) };
    const queue = new PublishQueue(drafts, publisher, review);
    const cycle = new CycleService(curator, generator, review, drafts, signals, cycles, tokens);
    review.onDecision(async (draftId, decision) => cycle.handleDecision(draftId, decision, NOW));

    // 1. The cycle produces exactly one draft awaiting review.
    expect(await cycle.runCycle(NOW)).toBe('RAN');
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0].status).toBe('PENDING_REVIEW');

    // 2. Nothing is published before approval.
    await queue.drain(NOW);
    expect((await drafts.findById(reviewed[0].id))?.publishedUrn).toBeNull();

    // 3. Approval publishes it.
    await handler(reviewed[0].id, { kind: 'approve' });
    await queue.drain(NOW);

    const published = await drafts.findById(reviewed[0].id);
    expect(published?.status).toBe('PUBLISHED');
    expect(published?.publishedUrn).toBe('urn:li:share:e2e');

    // 4. A second cycle finds no fresh material and skips instead of repeating itself.
    expect(await cycle.runCycle(NOW)).toBe('SKIPPED_NO_MATERIAL');
  });
});
