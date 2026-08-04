import { RawSignal, SignalSource } from '../signal.entity';

export interface SourcePort {
  readonly source: SignalSource;
  collect(since: Date): Promise<RawSignal[]>;
}

export const SOURCE_PORTS = Symbol('SourcePorts');
