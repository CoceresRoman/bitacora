import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { isSignalSource, RawSignal } from '../core/signal.entity';

interface SignalRow {
  id: string;
  source: string;
  kind: string;
  payload: string;
  refs: string;
  hash: string;
  capturedAt: Date;
}

function toDomain(row: SignalRow): RawSignal {
  if (!isSignalSource(row.source)) {
    throw new Error(`Unknown signal source in database: ${row.source}`);
  }
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    payload: row.payload,
    refs: JSON.parse(row.refs) as string[],
    capturedAt: row.capturedAt,
    hash: row.hash,
  };
}

@Injectable()
export class SignalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async saveNew(signals: RawSignal[]): Promise<RawSignal[]> {
    const inserted: RawSignal[] = [];
    for (const signal of signals) {
      const existing = await this.prisma.signal.findUnique({ where: { hash: signal.hash } });
      if (existing) continue;
      const row = await this.prisma.signal.create({
        data: {
          source: signal.source,
          kind: signal.kind,
          payload: signal.payload,
          refs: JSON.stringify(signal.refs),
          hash: signal.hash,
          capturedAt: signal.capturedAt,
        },
      });
      inserted.push(toDomain(row));
    }
    return inserted;
  }

  async findUnused(): Promise<RawSignal[]> {
    const rows = await this.prisma.signal.findMany({
      where: { usedAt: null },
      orderBy: { capturedAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async markUsed(id: string): Promise<void> {
    await this.prisma.signal.update({ where: { id }, data: { usedAt: new Date() } });
  }
}
