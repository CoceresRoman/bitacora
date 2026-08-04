// Hand-written type declarations for bridge-server.js.
//
// bridge-server.js is intentionally plain CommonJS (see the comment at the
// top of that file for why); this .d.ts gives TypeScript consumers
// (currently bridge-server.spec.ts) proper types without needing
// `allowJs` project-wide or a build step for scripts/claude-bridge.mjs.

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface BridgeDeps {
  secret: string;
  runClaude: (prompt: string) => Promise<string>;
}

export type BridgeRequestListener = (req: IncomingMessage, res: ServerResponse) => void;

export function createRequestListener(deps: BridgeDeps): BridgeRequestListener;

export function requireSecret(secret: string | undefined): string;
