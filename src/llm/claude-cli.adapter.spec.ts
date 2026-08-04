import { ClaudeCliAdapter } from './claude-cli.adapter';

const CONFIG = { url: 'http://127.0.0.1:8788', secret: 'devsecret', timeoutMs: 5000 };

describe('ClaudeCliAdapter', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts the prompt to /generate with the secret header', async () => {
    const spy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'salida' }) });
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await new ClaudeCliAdapter(CONFIG).generate('mi prompt');

    expect(result).toBe('salida');
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8788/generate');
    expect(init.method).toBe('POST');
    expect(init.headers['x-bridge-secret']).toBe('devsecret');
    expect(JSON.parse(init.body)).toEqual({ prompt: 'mi prompt' });
  });

  it('throws a clear error when the bridge rejects the secret', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"unauthorized"}',
    }) as unknown as typeof fetch;

    await expect(new ClaudeCliAdapter(CONFIG).generate('x')).rejects.toThrow(/401/);
  });

  it('throws when the bridge is unreachable', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    await expect(new ClaudeCliAdapter(CONFIG).generate('x')).rejects.toThrow(
      /claude bridge unreachable/i,
    );
  });

  it('rejects a response with no text field', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;

    await expect(new ClaudeCliAdapter(CONFIG).generate('x')).rejects.toThrow(/malformed/i);
  });
});
