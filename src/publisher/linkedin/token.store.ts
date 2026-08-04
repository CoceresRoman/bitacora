import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence/prisma.service';
import { decrypt, encrypt } from '../crypto';

export const ENCRYPTION_KEY = Symbol('EncryptionKey');
export const REAUTH_WARNING_DAYS = 5;

const SINGLETON_ID = 'singleton';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LinkedInToken {
  accessToken: string;
  memberUrn: string;
  expiresAt: Date;
}

@Injectable()
export class TokenStore {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENCRYPTION_KEY) private readonly keyHex: string,
  ) {}

  async save(token: LinkedInToken): Promise<void> {
    const data = {
      encryptedAccessToken: encrypt(token.accessToken, this.keyHex),
      memberUrn: token.memberUrn,
      expiresAt: token.expiresAt,
    };
    await this.prisma.linkedInToken.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
  }

  async current(): Promise<LinkedInToken | null> {
    const row = await this.prisma.linkedInToken.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return null;
    return {
      accessToken: decrypt(row.encryptedAccessToken, this.keyHex),
      memberUrn: row.memberUrn,
      expiresAt: row.expiresAt,
    };
  }

  async needsReauth(now: Date): Promise<boolean> {
    const row = await this.prisma.linkedInToken.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return true;
    return row.expiresAt.getTime() - now.getTime() <= REAUTH_WARNING_DAYS * DAY_MS;
  }
}
