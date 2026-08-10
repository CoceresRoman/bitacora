import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);
  // Bind to loopback only: the LinkedIn OAuth routes (/auth/linkedin,
  // /auth/linkedin/callback) have no auth guard, so binding to every
  // interface would let anyone reachable on the LAN or the owner's
  // Tailscale network complete their own LinkedIn consent and overwrite the
  // stored token, hijacking which account this service posts to. Reaching
  // the OAuth flow from another device requires an SSH tunnel (or adding a
  // real auth guard), not a wider bind.
  await app.listen(config.get('PORT', { infer: true }), '127.0.0.1');
}

void bootstrap();
