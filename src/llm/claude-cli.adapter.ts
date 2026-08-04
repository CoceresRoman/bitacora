import { Inject, Injectable } from '@nestjs/common';
import { LlmPort } from '../core/ports/llm.port';

export interface ClaudeBridgeConfig {
  url: string;
  secret: string;
  timeoutMs: number;
}

export const CLAUDE_BRIDGE_CONFIG = Symbol('ClaudeBridgeConfig');

@Injectable()
export class ClaudeCliAdapter implements LlmPort {
  constructor(@Inject(CLAUDE_BRIDGE_CONFIG) private readonly config: ClaudeBridgeConfig) {}

  async generate(prompt: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/generate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bridge-secret': this.config.secret,
        },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new Error(`Claude bridge unreachable: ${(error as Error).message}`);
    }

    if (!response.ok) {
      throw new Error(`Claude bridge returned ${response.status}: ${await response.text()}`);
    }

    let body: { text?: unknown };
    try {
      body = (await response.json()) as { text?: unknown };
    } catch (error) {
      throw new Error(`Malformed bridge response: ${(error as Error).message}`);
    }
    if (typeof body.text !== 'string') {
      throw new Error('Malformed bridge response: missing "text"');
    }
    return body.text;
  }
}
