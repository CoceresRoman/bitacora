import { Test, TestingModule } from '@nestjs/testing';
import { LLM_PORT } from '../src/core/ports/llm.port';
import { PUBLISHER_PORT } from '../src/core/ports/publisher.port';
import { REVIEW_CHANNEL_PORT } from '../src/core/ports/review-channel.port';
import { SOURCE_PORTS, SourcePort } from '../src/core/ports/source.port';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { CycleService } from '../src/scheduler/cycle.service';
import { PublishQueue } from '../src/publisher/publish.queue';
import { GeneratorService } from '../src/generator/generator.service';
import { CuratorService } from '../src/curator/curator.service';
import { TokenStore } from '../src/publisher/linkedin/token.store';

/**
 * No individual feature module's own tests ever build the real AppModule:
 * they all instantiate services by hand, so a provider that is registered
 * in isolation but never wired into AppModule (or wired with a missing
 * import, like PublisherModule <-> TelegramModule before this suite existed)
 * would only surface as a runtime crash on boot. This spec builds the real
 * Nest container from AppModule and proves the whole graph resolves.
 *
 * Syntactically valid but non-functional values — nothing here is a real
 * LinkedIn app, Telegram bot, or reachable Claude bridge. There is
 * deliberately no ANTHROPIC_API_KEY anywhere: the LLM port talks to a local
 * Claude CLI bridge, never the Anthropic API directly.
 */
const FAKE_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: 'file:./data/app-module-spec.db',
  ENCRYPTION_KEY: 'a'.repeat(64),
  TELEGRAM_BOT_TOKEN: 'fake-telegram-bot-token',
  TELEGRAM_ALLOWED_CHAT_ID: '000000',
  CLAUDE_BRIDGE_URL: 'http://127.0.0.1:8788',
  CLAUDE_BRIDGE_SECRET: 'fake-bridge-secret',
  LINKEDIN_CLIENT_ID: 'fake-client-id',
  LINKEDIN_CLIENT_SECRET: 'fake-client-secret',
  LINKEDIN_REDIRECT_URI: 'http://localhost:3000/auth/linkedin/callback',
  LINKEDIN_API_VERSION: '202508',
  GITHUB_USERNAME: 'fake-github-user',
  LOCAL_REPOS: '',
  TRENDS_REPOS: 'nestjs/nest',
  PORT: '3000',
};

describe('AppModule (DI wiring)', () => {
  const originalEnv = { ...process.env };
  let moduleRef: TestingModule;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    Object.assign(process.env, FAKE_ENV);

    // AppModule's @Module decorator calls ConfigModule.forRoot({ validate })
    // synchronously the moment the module is loaded, and that validate call
    // reads process.env immediately — before any test body runs. ts-jest
    // compiles a static top-level `import { AppModule } from '...'` down to
    // a require() hoisted above this file's own code, which would run
    // before the fake env above is assigned. Requiring it dynamically here,
    // after the env is set, is what makes the fake env take effect.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../src/app.module');

    // Building providers via constructor injection is the only thing
    // Test.createTestingModule(...).compile() does: it never calls
    // app.init() (that only happens via NestFactory.create(...).init() /
    // .listen(), or an explicit moduleRef.init() in a test). Lifecycle
    // hooks — TelegramAdapter.onModuleInit(), which starts the long-polling
    // loop against api.telegram.org, and @nestjs/schedule's own
    // OnModuleInit hook, which registers and starts the CronJob instances
    // for SchedulerService — are OnModuleInit hooks, so neither one fires
    // here. The fetch spy below is a black-box check that this is actually
    // true: nothing under compile() reaches the network.
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('unexpected network call while constructing the DI graph');
    });

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    // No lifecycle hook ever ran, so close() only releases whatever
    // bookkeeping Nest itself holds for this container — there is no open
    // Telegram poll, cron job, or DB connection to tear down.
    await moduleRef?.close();
    process.env = originalEnv;
  });

  it('never touched the network while building the container', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves every service across the wired module graph', () => {
    expect(moduleRef.get(SchedulerService)).toBeInstanceOf(SchedulerService);
    expect(moduleRef.get(CycleService)).toBeInstanceOf(CycleService);
    expect(moduleRef.get(PublishQueue)).toBeInstanceOf(PublishQueue);
    expect(moduleRef.get(GeneratorService)).toBeInstanceOf(GeneratorService);
    expect(moduleRef.get(CuratorService)).toBeInstanceOf(CuratorService);
    expect(moduleRef.get(TokenStore)).toBeInstanceOf(TokenStore);
  });

  it('resolves every port token to a concrete adapter', () => {
    expect(moduleRef.get(REVIEW_CHANNEL_PORT)).toBeDefined();
    expect(moduleRef.get(LLM_PORT)).toBeDefined();
    expect(moduleRef.get(PUBLISHER_PORT)).toBeDefined();

    const sources = moduleRef.get<SourcePort[]>(SOURCE_PORTS);
    expect(sources).toHaveLength(3);
    expect(sources.map((source) => source.source).sort()).toEqual(['git', 'inbox', 'trends']);
  });
});
