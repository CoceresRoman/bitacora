# Claude CLI bridge

The Claude CLI bridge is a small local HTTP server (`scripts/claude-bridge.mjs`) that lets the
Bitacora application generate text using the developer's own Claude CLI subscription, without
ever calling a remote LLM API directly from the application process. The application talks to
the bridge over `localhost`; the bridge shells out to the `claude` CLI already installed and
authenticated on the machine. No API key is used or required — the bridge relies entirely on
the local Claude CLI's existing subscription/login.

## Starting the bridge

The bridge requires a shared secret. It refuses to start without one:

```bash
CLAUDE_BRIDGE_SECRET=your-local-secret npm run bridge
```

Optional environment variables:

- `CLAUDE_BRIDGE_PORT` — port to listen on (default `8788`).
- `CLAUDE_BRIDGE_TIMEOUT_MS` — timeout for a single `claude` invocation, in milliseconds
  (default `180000`).

On success it prints:

```
claude bridge listening on http://127.0.0.1:8788
```

## Request/response contract

- `POST /generate`
  - Header: `x-bridge-secret: <shared secret>` (required)
  - Body: `{ "prompt": string }`
- `200 { "text": string }` — the CLI's generated text, taken from the `result` field of
  `claude -p --output-format json`.
- `401 { "error": "unauthorized" }` — missing or incorrect `x-bridge-secret` header.
- `400 { "error": "prompt is required" }` — missing or empty `prompt`.
- `404 { "error": "not found" }` — any request that is not `POST /generate`.
- `500 { "error": string }` — the `claude` CLI failed, timed out, or returned output that
  could not be parsed as the expected JSON shape.

## Security properties

- **Loopback-only bind.** The server binds to `127.0.0.1` exclusively — never `0.0.0.0` and
  never a configurable host. It is not reachable from other machines on the network under
  normal operation.
- **Shared secret required.** Every request must include a correct `x-bridge-secret` header
  matching `CLAUDE_BRIDGE_SECRET`, or the bridge responds `401`.

Exposing this bridge on a non-loopback interface (for example by changing the bind address or
port-forwarding it) would let anyone who can reach that interface spend the machine owner's
Claude usage quota by issuing prompts through it. Do not do this — keep the bridge bound to
`127.0.0.1` and treat `CLAUDE_BRIDGE_SECRET` as a real secret.
