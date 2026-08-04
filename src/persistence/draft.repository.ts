import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Draft, DraftStatus, REVIEW_EXPIRY_HOURS, Revision } from '../core/draft.entity';

const STATUSES: readonly DraftStatus[] = [
  'DRAFTING',
  'PENDING_REVIEW',
  'REVISING',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'DISCARDED',
  'EXPIRED',
];

interface DraftRow {
  id: string;
  signalId: string;
  topic: string;
  bodyEs: string;
  status: string;
  revisions: string;
  scheduledAt: Date | null;
  publishedUrn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: DraftRow): Draft {
  if (!(STATUSES as readonly string[]).includes(row.status)) {
    throw new Error(`Unknown draft status in database: ${row.status}`);
  }
  const revisions = (JSON.parse(row.revisions) as Array<Omit<Revision, 'at'> & { at: string }>).map(
    (revision) => ({ ...revision, at: new Date(revision.at) }),
  );
  return { ...row, status: row.status as DraftStatus, revisions };
}

@Injectable()
export class DraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { signalId: string; topic: string; bodyEs: string }): Promise<Draft> {
    const row = await this.prisma.draft.create({ data: { ...input, status: 'DRAFTING' } });
    return toDomain(row);
  }

  async findById(id: string): Promise<Draft | null> {
    const row = await this.prisma.draft.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async save(draft: Draft): Promise<Draft> {
    const row = await this.prisma.draft.update({
      where: { id: draft.id },
      data: {
        topic: draft.topic,
        bodyEs: draft.bodyEs,
        status: draft.status,
        revisions: JSON.stringify(draft.revisions),
        scheduledAt: draft.scheduledAt,
        publishedUrn: draft.publishedUrn,
      },
    });
    return toDomain(row);
  }

  async recentTopics(days: number, now: Date): Promise<string[]> {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.draft.findMany({
      where: { createdAt: { gte: since } },
      select: { topic: true },
    });
    return rows.map((row) => row.topic);
  }

  async findDuePublication(now: Date): Promise<Draft[]> {
    const rows = await this.prisma.draft.findMany({
      where: {
        publishedUrn: null,
        OR: [{ status: 'APPROVED' }, { status: 'SCHEDULED', scheduledAt: { lte: now } }],
      },
    });
    return rows.map(toDomain);
  }

  async findExpirable(now: Date): Promise<Draft[]> {
    const cutoff = new Date(now.getTime() - REVIEW_EXPIRY_HOURS * 60 * 60 * 1000);
    const rows = await this.prisma.draft.findMany({
      where: { status: 'PENDING_REVIEW', updatedAt: { lt: cutoff } },
    });
    return rows.map(toDomain);
  }

  async incrementAttempts(id: string): Promise<number> {
    const row = await this.prisma.draft.update({
      where: { id },
      data: { publishAttempts: { increment: 1 } },
      select: { publishAttempts: true },
    });
    return row.publishAttempts;
  }

  async attemptsFor(id: string): Promise<number> {
    const row = await this.prisma.draft.findUnique({
      where: { id },
      select: { publishAttempts: true },
    });
    return row?.publishAttempts ?? 0;
  }
}
