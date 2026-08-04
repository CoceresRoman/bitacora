import { decrypt, encrypt } from './crypto';

const KEY = 'b'.repeat(64);
const OTHER_KEY = 'c'.repeat(64);

describe('encrypt/decrypt', () => {
  it('round-trips a token', () => {
    expect(decrypt(encrypt('secret-token', KEY), KEY)).toBe('secret-token');
  });

  it('produces a different ciphertext each time', () => {
    expect(encrypt('secret-token', KEY)).not.toBe(encrypt('secret-token', KEY));
  });

  it('never leaks the plaintext into the payload', () => {
    expect(encrypt('secret-token', KEY)).not.toContain('secret-token');
  });

  it('fails to decrypt with a different key', () => {
    expect(() => decrypt(encrypt('secret-token', KEY), OTHER_KEY)).toThrow();
  });

  it('fails when the ciphertext was tampered with', () => {
    const [iv, tag, cipher] = encrypt('secret-token', KEY).split(':');
    const flipped = cipher.startsWith('a') ? `b${cipher.slice(1)}` : `a${cipher.slice(1)}`;
    expect(() => decrypt(`${iv}:${tag}:${flipped}`, KEY)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encrypt('x', 'ab')).toThrow(/32 bytes/i);
  });
});
