import { signalHash } from './signal.entity';

describe('signalHash', () => {
  it('is stable for the same source and payload', () => {
    expect(signalHash('git', 'abc123 fix retry backoff')).toEqual(
      signalHash('git', 'abc123 fix retry backoff'),
    );
  });

  it('differs when the source differs', () => {
    expect(signalHash('git', 'same')).not.toEqual(signalHash('trends', 'same'));
  });

  it('ignores surrounding whitespace', () => {
    expect(signalHash('inbox', '  idea  ')).toEqual(signalHash('inbox', 'idea'));
  });
});
