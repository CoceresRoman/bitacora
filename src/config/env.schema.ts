import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex chars'),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_CHAT_ID: z.string().min(1),
  CLAUDE_BRIDGE_URL: z.string().url(),
  CLAUDE_BRIDGE_SECRET: z.string().min(1),
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_REDIRECT_URI: z.string().url(),
  LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/),
  GITHUB_USERNAME: z.string().min(1),
  GITHUB_TOKEN: z.string().optional(),
  LOCAL_REPOS: csv,
  TRENDS_REPOS: csv,
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;
