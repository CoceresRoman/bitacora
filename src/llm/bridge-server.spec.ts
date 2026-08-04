import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequestListener, requireSecret } from './bridge-server';

const SECRET = 'devsecret';

interface RequestOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}

function makeRequest(options: RequestOptions): IncomingMessage {
  const req = Readable.from([options.body ?? '']) as unknown as IncomingMessage;
  Object.assign(req, {
    method: options.method ?? 'POST',
    url: options.url ?? '/generate',
    headers: options.headers ?? {},
  });
  return req;
}

interface CapturedResponse {
  status: number;
  body: unknown;
}

function makeResponse(): { res: ServerResponse; done: Promise<CapturedResponse> } {
  let resolveDone!: (value: CapturedResponse) => void;
  const done = new Promise<CapturedResponse>((resolve) => {
    resolveDone = resolve;
  });
  let status = 0;
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(raw?: string) {
      resolveDone({ status, body: raw ? JSON.parse(raw) : undefined });
    },
  } as unknown as ServerResponse;
  return { res, done };
}

describe('bridge-server request listener', () => {
  const runClaude = jest.fn<Promise<string>, [string]>();

  afterEach(() => {
    runClaude.mockReset();
  });

  it('returns 401 when the secret header is wrong', async () => {
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({ headers: { 'x-bridge-secret': 'wrong' }, body: '{"prompt":"x"}' });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret header is missing entirely', async () => {
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({ headers: {}, body: '{"prompt":"x"}' });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-POST request', async () => {
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({ method: 'GET', headers: { 'x-bridge-secret': SECRET } });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 404, body: { error: 'not found' } });
  });

  it('returns 404 for a POST to a path other than /generate', async () => {
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({ url: '/other', headers: { 'x-bridge-secret': SECRET } });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 404, body: { error: 'not found' } });
  });

  it('returns 400 when the prompt is missing', async () => {
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({ headers: { 'x-bridge-secret': SECRET }, body: '{}' });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 400, body: { error: 'prompt is required' } });
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('returns 400 when the prompt is an empty/whitespace string', async () => {
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({
      headers: { 'x-bridge-secret': SECRET },
      body: JSON.stringify({ prompt: '   ' }),
    });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 400, body: { error: 'prompt is required' } });
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('returns 400 when the prompt is not a string', async () => {
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({
      headers: { 'x-bridge-secret': SECRET },
      body: JSON.stringify({ prompt: 42 }),
    });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 400, body: { error: 'prompt is required' } });
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('returns 200 with the generated text on a valid request', async () => {
    runClaude.mockResolvedValue('generated output');
    const listener = createRequestListener({ secret: SECRET, runClaude });
    const req = makeRequest({
      headers: { 'x-bridge-secret': SECRET },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    const { res, done } = makeResponse();

    listener(req, res);

    await expect(done).resolves.toEqual({ status: 200, body: { text: 'generated output' } });
    expect(runClaude).toHaveBeenCalledWith('hello');
  });
});

describe('requireSecret', () => {
  it('throws when the secret is undefined', () => {
    expect(() => requireSecret(undefined)).toThrow(/CLAUDE_BRIDGE_SECRET is required/);
  });

  it('throws when the secret is an empty string', () => {
    expect(() => requireSecret('')).toThrow(/CLAUDE_BRIDGE_SECRET is required/);
  });

  it('returns the secret when set', () => {
    expect(requireSecret('devsecret')).toBe('devsecret');
  });
});
