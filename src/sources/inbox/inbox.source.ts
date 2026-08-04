import { Injectable } from '@nestjs/common';
import { RawSignal, signalHash, SignalSource } from '../../core/signal.entity';
import { SourcePort } from '../../core/ports/source.port';
import { SignalRepository } from '../../persistence/signal.repository';

@Injectable()
export class InboxSource implements SourcePort {
  readonly source: SignalSource = 'inbox';

  constructor(private readonly signals: SignalRepository) {}

  async capture(text: string, now: Date): Promise<void> {
    const payload = text.trim();
    if (payload.length === 0) {
      throw new Error('Cannot capture an empty idea');
    }
    await this.signals.saveNew([
      {
        id: '',
        source: 'inbox',
        kind: 'idea',
        payload,
        refs: [],
        capturedAt: now,
        hash: signalHash('inbox', payload),
      },
    ]);
  }

  async collect(_since: Date): Promise<RawSignal[]> {
    const unused = await this.signals.findUnused();
    return unused.filter((signal) => signal.source === 'inbox');
  }
}
