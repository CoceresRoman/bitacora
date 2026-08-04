#!/usr/bin/env node
// Local bridge to the Claude CLI. Uses your Claude subscription — no API key.
// Start with: CLAUDE_BRIDGE_SECRET=... npm run bridge
//
// The request-handling logic (auth check, JSON parsing, status codes) lives
// in src/llm/bridge-server.js so it can be unit tested without binding a
// port or spawning the real `claude` CLI — see src/llm/bridge-server.spec.ts.
// This file stays a thin, zero-build-step wiring layer: it owns the CLI
// spawn (runClaude) and the actual createServer/listen call.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequestListener, requireSecret } from '../src/llm/bridge-server.js';

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT ?? 8788);
const TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS ?? 180000);

let SECRET;
try {
  SECRET = requireSecret(process.env.CLAUDE_BRIDGE_SECRET);
} catch (error) {
  console.error(error.message);
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

const server = createServer(createRequestListener({ secret: SECRET, runClaude }));

// 127.0.0.1 only. Never bind this to a public interface.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`claude bridge listening on http://127.0.0.1:${PORT}`);
});
