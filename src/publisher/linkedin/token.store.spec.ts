import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../persistence/prisma.service';
import { TokenStore, REAUTH_WARNING_DAYS } from './token.store';

// Absolute path: Prisma resolves relative sqlite `file:` URLs relative to
// prisma/schema.prisma's directory, not process.cwd(), both for the CLI
// (`prisma db push`) and the generated client. A relative path here would
// make this file's rmSync() target a different location than the one
// Prisma actually writes to, leaking state across test runs.
const DB_PATH = join(process.cwd(), 'data', 'test-tokens.db');
const DATABASE_URL = `file:${DB_PATH}`;
const KEY = 'd'.repeat(64);
const NOW = new Date('2026-08-04T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('TokenStore', () => {
  let prisma: PrismaService;
  let store: TokenStore;

  beforeAll(() => {
    rmSync(DB_PATH, { force: true });
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL },
      stdio: 'ignore',
    });
    prisma = new PrismaService(DATABASE_URL);
    store = new TokenStore(prisma, KEY);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(DB_PATH, { force: true });
  });

  it('reports that reauth is needed when no token exists', async () => {
    expect(await store.needsReauth(NOW)).toBe(true);
    expect(await store.current()).toBeNull();
  });

  it('stores the token encrypted and returns it decrypted', async () => {
    await store.save({
      accessToken: 'AQX-real-token',
      memberUrn: 'urn:li:person:abc',
      expiresAt: new Date(NOW.getTime() + 60 * DAY_MS),
    });

    const row = await prisma.linkedInToken.findFirst();
    expect(row?.encryptedAccessToken).not.toContain('AQX-real-token');

    const current = await store.current();
    expect(current?.accessToken).toBe('AQX-real-token');
    expect(current?.memberUrn).toBe('urn:li:person:abc');
  });

  it('does not ask for reauth on a fresh token', async () => {
    expect(await store.needsReauth(NOW)).toBe(false);
  });

  it('asks for reauth inside the warning window', async () => {
    await store.save({
      accessToken: 'AQX-real-token',
      memberUrn: 'urn:li:person:abc',
      expiresAt: new Date(NOW.getTime() + (REAUTH_WARNING_DAYS - 1) * DAY_MS),
    });
    expect(await store.needsReauth(NOW)).toBe(true);
  });

  it('overwrites rather than accumulating token rows', async () => {
    await store.save({
      accessToken: 'AQX-second',
      memberUrn: 'urn:li:person:abc',
      expiresAt: new Date(NOW.getTime() + 60 * DAY_MS),
    });
    expect(await prisma.linkedInToken.count()).toBe(1);
    expect((await store.current())?.accessToken).toBe('AQX-second');
  });
});
