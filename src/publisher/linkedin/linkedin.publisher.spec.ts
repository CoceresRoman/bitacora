import { LinkedInPublisher } from './linkedin.publisher';
import { TokenStore } from './token.store';

const TOKEN = {
  accessToken: 'AQX-token',
  memberUrn: 'urn:li:person:abc',
  expiresAt: new Date('2026-10-01T00:00:00Z'),
};

function store(token: typeof TOKEN | null): TokenStore {
  return { current: async () => token } as unknown as TokenStore;
}

describe('LinkedInPublisher', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts to /rest/posts with the versioned headers and returns the URN', async () => {
    const spy = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'x-restli-id': 'urn:li:share:999' }),
      text: async () => '',
    });
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await new LinkedInPublisher(store(TOKEN), '202508').publish('texto del post');

    expect(result.urn).toBe('urn:li:share:999');
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect(init.headers.Authorization).toBe('Bearer AQX-token');
    expect(init.headers['LinkedIn-Version']).toBe('202508');
    expect(init.headers['X-Restli-Protocol-Version']).toBe('2.0.0');

    const body = JSON.parse(init.body);
    expect(body.author).toBe('urn:li:person:abc');
    expect(body.commentary).toBe('texto del post');
    expect(body.visibility).toBe('PUBLIC');
    expect(body.lifecycleState).toBe('PUBLISHED');
  });

  it('throws when there is no stored token', async () => {
    await expect(new LinkedInPublisher(store(null), '202508').publish('x')).rejects.toThrow(
      /not connected/i,
    );
  });

  it('throws with the status and body when LinkedIn rejects the post', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers(),
      text: async () => '{"message":"invalid"}',
    }) as unknown as typeof fetch;

    await expect(new LinkedInPublisher(store(TOKEN), '202508').publish('x')).rejects.toThrow(/422/);
  });

  it('never puts the access token in the thrown error', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => 'unauthorized',
    }) as unknown as typeof fetch;

    await expect(new LinkedInPublisher(store(TOKEN), '202508').publish('x')).rejects.not.toThrow(
      /AQX-token/,
    );
  });
});
