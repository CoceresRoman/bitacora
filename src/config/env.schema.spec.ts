import { envSchema } from './env.schema';

const valid = {
  DATABASE_URL: 'file:./data/test.db',
  ENCRYPTION_KEY: 'a'.repeat(64),
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_ALLOWED_CHAT_ID: '123456',
  CLAUDE_BRIDGE_URL: 'http://127.0.0.1:8788',
  CLAUDE_BRIDGE_SECRET: 'secret',
  LINKEDIN_CLIENT_ID: 'id',
  LINKEDIN_CLIENT_SECRET: 'secret',
  LINKEDIN_REDIRECT_URI: 'http://localhost:3000/auth/linkedin/callback',
  LINKEDIN_API_VERSION: '202508',
  GITHUB_USERNAME: 'CoceresRoman',
  TRENDS_REPOS: 'nestjs/nest',
};

describe('envSchema', () => {
  it('accepts a fully populated environment', () => {
    expect(() => envSchema.parse(valid)).not.toThrow();
  });

  it('rejects a missing TELEGRAM_ALLOWED_CHAT_ID', () => {
    const { TELEGRAM_ALLOWED_CHAT_ID, ...rest } = valid;
    expect(() => envSchema.parse(rest)).toThrow();
  });

  it('rejects an ENCRYPTION_KEY that is not 64 hex chars', () => {
    expect(() => envSchema.parse({ ...valid, ENCRYPTION_KEY: 'short' })).toThrow();
  });

  it('parses comma-separated lists into arrays', () => {
    const parsed = envSchema.parse({ ...valid, LOCAL_REPOS: '/a,/b' });
    expect(parsed.LOCAL_REPOS).toEqual(['/a', '/b']);
    expect(parsed.TRENDS_REPOS).toEqual(['nestjs/nest']);
  });

  it('defaults LOCAL_REPOS to an empty list', () => {
    expect(envSchema.parse(valid).LOCAL_REPOS).toEqual([]);
  });
});
