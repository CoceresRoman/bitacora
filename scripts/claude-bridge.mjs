#!/usr/bin/env node
// Local bridge to the Claude CLI. Uses your Claude subscription — no API key.
// Start with: CLAUDE_BRIDGE_SECRET=... npm run bridge
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT ?? 8788);
const SECRET = process.env.CLAUDE_BRIDGE_SECRET;
const TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS ?? 180000);

if (!SECRET) {
  console.error('CLAUDE_BRIDGE_SECRET is required');
  process.exit(1);
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `claude exited with ${code}`));
      try {
        const parsed = JSON.parse(stdout);
        if (typeof parsed.result !== 'string') {
          return reject(new Error('claude response has no string "result" field'));
        }
        resolve(parsed.result);
      } catch (error) {
        reject(new Error(`unparseable claude output: ${error.message}`));
      }
    });

    child.stdin.end(prompt);
  });
}

const server = createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'POST' || req.url !== '/generate') return send(404, { error: 'not found' });
  if (req.headers['x-bridge-secret'] !== SECRET) return send(401, { error: 'unauthorized' });

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
});

// 127.0.0.1 only. Never bind this to a public interface.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`claude bridge listening on http://127.0.0.1:${PORT}`);
});
