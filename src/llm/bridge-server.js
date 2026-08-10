// Request-handling logic for the Claude CLI bridge, extracted out of
// scripts/claude-bridge.mjs so it can be unit tested without binding a
// port and without spawning the real `claude` CLI.
//
// This file is deliberately plain CommonJS, not TypeScript:
//   - scripts/claude-bridge.mjs (the actual `npm run bridge` entrypoint)
//     is a zero-build-step Node script. ESM can import a CommonJS module
//     directly with no compilation step, so requiring TypeScript here
//     would either need a build step first (which the bridge must not
//     need) or an ad-hoc runtime transpiler (more moving parts in a
//     security-critical file, not fewer).
//   - Jest already resolves and requires plain `.js` files natively
//     (see jest.config.js `moduleFileExtensions`), so this module is
//     testable from `src/llm/bridge-server.spec.ts` with zero extra
//     configuration.
// See bridge-server.d.ts for the type-checked shape used by TypeScript
// consumers (currently just the test file).

/**
 * Builds the http.Server request listener for the Claude CLI bridge.
 * Pure function of its dependencies: does not bind a port, does not spawn
 * `claude` itself (that lives behind the injected `runClaude`).
 *
 * @param {{ secret: string, runClaude: (prompt: string) => Promise<string> }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
function createRequestListener(deps) {
  const { secret, runClaude } = deps;

  return function requestListener(req, res) {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'POST' || req.url !== '/generate') {
      return send(404, { error: 'not found' });
    }
    if (req.headers['x-bridge-secret'] !== secret) {
      return send(401, { error: 'unauthorized' });
    }

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      try {
        const { prompt } = JSON.parse(raw);
        if (typeof prompt !== 'string' || prompt.trim() === '') {
          return send(400, { error: 'prompt is required' });
        }
        send(200, { text: await runClaude(prompt) });
      } catch (error) {
        send(500, { error: error.message });
      }
    });
  };
}

/**
 * Validates that a bridge secret is configured. The bridge must refuse to
 * start without one, since an unset secret would otherwise accept every
 * request.
 *
 * @param {string | undefined} secret
 * @returns {string}
 */
function requireSecret(secret) {
  if (!secret) {
    throw new Error('CLAUDE_BRIDGE_SECRET is required');
  }
  return secret;
}

module.exports = { createRequestListener, requireSecret };
