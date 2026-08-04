import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.schema';
import { TokenStore } from './token.store';

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const SCOPES = 'openid profile w_member_social';

// `@types/express` is not a dependency of this project (verified: absent
// from package.json and the resolved node_modules tree on feat/mvp), so
// `import type { Response } from 'express'` fails `tsc` with TS7016 even
// though the package that ships the runtime object (@nestjs/platform-express)
// is installed. This file is out of scope for adding that dependency
// (package.json is owned by another task), so we declare the minimal shape
// this controller actually uses instead of pulling in express's full types.
// NestJS's @Res() decorator injects the real Express response object at
// runtime regardless of the TypeScript annotation here.
interface RedirectableResponse {
  redirect(url: string): void;
}

@Controller('auth/linkedin')
export class LinkedInOAuthController {
  private readonly logger = new Logger(LinkedInOAuthController.name);
  private pendingState: string | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly tokens: TokenStore,
  ) {}

  @Get()
  start(@Res() res: RedirectableResponse): void {
    this.pendingState = randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.get('LINKEDIN_CLIENT_ID', { infer: true }),
      redirect_uri: this.config.get('LINKEDIN_REDIRECT_URI', { infer: true }),
      state: this.pendingState,
      scope: SCOPES,
    });
    res.redirect(`${AUTH_URL}?${params.toString()}`);
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string): Promise<string> {
    if (!this.pendingState || state !== this.pendingState) {
      return 'Invalid state. Start again at /auth/linkedin';
    }
    this.pendingState = null;

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.get('LINKEDIN_REDIRECT_URI', { infer: true }),
        client_id: this.config.get('LINKEDIN_CLIENT_ID', { infer: true }),
        client_secret: this.config.get('LINKEDIN_CLIENT_SECRET', { infer: true }),
      }),
    });
    if (!tokenResponse.ok) {
      this.logger.error(`Token exchange failed with status ${tokenResponse.status}`);
      return 'Token exchange failed. Check the server logs.';
    }
    const token = (await tokenResponse.json()) as { access_token: string; expires_in: number };

    const userinfo = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userinfo.ok) {
      this.logger.error(`Userinfo failed with status ${userinfo.status}`);
      return 'Could not read the member id. Check the server logs.';
    }
    const { sub } = (await userinfo.json()) as { sub: string };

    await this.tokens.save({
      accessToken: token.access_token,
      memberUrn: `urn:li:person:${sub}`,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    });

    return 'LinkedIn connected. You can close this tab.';
  }
}
