import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_PORT } from '../core/ports/llm.port';
import type { Env } from '../config/env.schema';
import { ClaudeCliAdapter, CLAUDE_BRIDGE_CONFIG } from './claude-cli.adapter';

const BRIDGE_TIMEOUT_MS = 180_000;

@Module({
  providers: [
    {
      provide: CLAUDE_BRIDGE_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        url: config.get('CLAUDE_BRIDGE_URL', { infer: true }),
        secret: config.get('CLAUDE_BRIDGE_SECRET', { infer: true }),
        timeoutMs: BRIDGE_TIMEOUT_MS,
      }),
    },
    { provide: LLM_PORT, useClass: ClaudeCliAdapter },
  ],
  exports: [LLM_PORT],
})
export class LlmModule {}
