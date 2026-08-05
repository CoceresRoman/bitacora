# bitacora

bitacora turns your real engineering activity — commits, GitHub events, ideas you jot
down, relevant trends — into draft LinkedIn posts written in your own voice. It never
publishes anything on its own: every draft is sent to you on Telegram first, and only
your approval, a schedule you set, or a discard decision moves it forward. Nothing goes
to LinkedIn without a human tapping a button.

## How it flows

```
 ┌──────────┐   ┌──────────┐   ┌──────────┐
 │   git    │   │  inbox   │   │  trends  │   sources: local commits, GitHub
 │  events  │   │ (Telegram│   │ (HN/repo │   events, ideas you send yourself,
 │          │   │  ideas)  │   │ releases)│   and relevant tech trends.
 └────┬─────┘   └────┬─────┘   └────┬─────┘
      └──────────────┼──────────────┘
                      ▼
              ┌───────────────┐
              │    curator    │  scores + picks one signal per cycle,
              │               │  vetoes anything too close to a recent post
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │   generator   │  local Claude CLI + voice-profile.md,
              │ (+style guard)│  retries once if the style guard flags it
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │   Telegram    │  draft arrives with four buttons:
              │  (review gate)│  Approve / Rewrite / Schedule 09:00 / Discard
              └───────┬───────┘
                      │ approve / schedule fires
                      ▼
              ┌───────────────┐
              │   LinkedIn    │  publish queue, exponential backoff on 429s,
              │  (publisher)  │  gives up and notifies after 3 attempts
              └───────────────┘
```

A scheduled cycle runs Monday/Wednesday/Friday at 08:00; the publish queue and stale-draft
expiry run every 5 minutes.

## Requirements

- **Node.js 22+**
- The **Claude CLI** installed and logged in on the machine that will run this service
  (`claude` must work from a shell with no extra flags — bitacora shells out to it via a
  local bridge, it does not call any hosted API)
- A **Telegram bot** (create one with [@BotFather](https://t.me/BotFather)) and your own
  Telegram chat id
- A **LinkedIn developer app** with the `Sign In with LinkedIn using OpenID Connect` and
  `Share on LinkedIn` products enabled — see [`docs/linkedin.md`](docs/linkedin.md) for the
  full walkthrough

## Setup

1. Clone the repository:
   ```bash
   git clone git@github.com:CoceresRoman/bitacora.git
   cd bitacora
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
4. Generate the encryption key used to store your LinkedIn token at rest:
   ```bash
   openssl rand -hex 32
   ```
   Paste the output into `ENCRYPTION_KEY` in `.env`.
5. Apply the database schema:
   ```bash
   npx prisma migrate deploy
   ```
6. Get your Telegram chat id by messaging [@userinfobot](https://t.me/userinfobot) — it
   replies with your numeric id. Put it in `TELEGRAM_ALLOWED_CHAT_ID` in `.env`, along with
   your bot token in `TELEGRAM_BOT_TOKEN`.
7. Fill in the LinkedIn variables (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`,
   `LINKEDIN_REDIRECT_URI`, `LINKEDIN_API_VERSION`) — see
   [`docs/linkedin.md`](docs/linkedin.md).
8. Start the Claude CLI bridge in one terminal:
   ```bash
   npm run bridge
   ```
9. Start the app in another terminal:
   ```bash
   npm start
   ```
10. Open `http://localhost:3000/auth/linkedin` in a browser logged into the LinkedIn
    account that should own the posts, and approve the consent screen.

From here, the scheduler takes over: it runs a cycle Monday/Wednesday/Friday at 08:00 and
drains the publish queue every 5 minutes. You can also send yourself an idea on Telegram at
any time — it gets folded into the next cycle.

**Neither of the two steps above that talk to a live external service — the LinkedIn OAuth
round trip in step 10, and the Telegram bot flow (long polling, buttons, callbacks) — has
been exercised against the real LinkedIn or Telegram services as part of building this
project.** Both are covered by automated tests that exercise the code against fakes
(`TelegramClient`/`TelegramAdapter` and the LinkedIn OAuth handler are tested with fake
HTTP responses, not real API calls). Treat the first real run of each as the actual
first test.

## Security

- **`TELEGRAM_ALLOWED_CHAT_ID` is mandatory.** The process validates its environment at
  startup (`src/config/env.schema.ts`) and refuses to boot if it is missing. Without it, the
  bot would accept commands — including approving posts — from any chat that finds it, not
  just its owner.
- **LinkedIn tokens are encrypted at rest** with AES-256-GCM (`src/publisher/crypto.ts`),
  keyed by `ENCRYPTION_KEY`. The database only ever stores ciphertext.
- **The Claude CLI bridge binds to `127.0.0.1` only** (`scripts/claude-bridge.mjs`) and
  requires a shared secret (`CLAUDE_BRIDGE_SECRET`) on every request — see
  [`docs/bridge.md`](docs/bridge.md).
- **The OAuth callback route has no auth guard of its own** — anyone who can reach
  `/auth/linkedin/callback` while a flow is pending could hijack the token exchange. For that
  reason `src/main.ts` binds the whole HTTP server to `127.0.0.1` only, the same as the
  bridge. The practical consequence: if you're not on the same machine, reaching
  `/auth/linkedin` to (re)connect the LinkedIn account requires an SSH tunnel
  (`ssh -L 3000:127.0.0.1:3000 host`) — there is no wider bind to fall back to, by design.
- **Never commit `.env` or `data/`.** Both are already in `.gitignore`; `data/` holds the
  SQLite database with your (encrypted) LinkedIn token and post history.

## Known limitations

- **The machine has to be on for the cron to fire.** Cycles are scheduled Mon/Wed/Fri at
  08:00 in the process's local time. If the machine is off or asleep at that moment, the
  next boot recovers the missed cycle — but only if it comes back within a **12-hour grace
  window** of the missed slot. Beyond that, the cycle is recorded as skipped and not
  retried.
- **The LinkedIn access token expires in about 60 days.** You get a Telegram reminder once
  it is within 5 days of expiring (day ~55), prompting you to revisit
  `http://localhost:3000/auth/linkedin`. Whether LinkedIn's OpenID Connect flow issues a
  `refresh_token` for this app configuration is unconfirmed — see the open item in
  [`docs/linkedin.md`](docs/linkedin.md).
- **An ambiguous LinkedIn response can still cause a duplicate post.** If LinkedIn accepts
  the post but the response carries no `x-restli-id` header, or a `fetch` timeout or network
  error arrives after LinkedIn already created the post, `LinkedInPublisher.publish`
  (`src/publisher/linkedin/linkedin.publisher.ts`) throws with no URN to return. The service
  genuinely cannot tell whether the post exists. That throw lands in the same `catch` as any
  other publish failure in `PublishQueue.publishOne` (`src/publisher/publish.queue.ts`), which
  calls `recordFailedAttempt` and lets the next five-minute drain call `publish()` again with
  the identical text — so the same post can appear twice on the profile. This is distinct from
  the storage-failure case below, which is closed. Retries are capped at
  `MAX_PUBLISH_ATTEMPTS` (3), so the worst case is bounded, not unbounded.
- **A storage failure right after a successful LinkedIn publish no longer triggers an
  automatic retry.** `PublishQueue.publishOne` (`src/publisher/publish.queue.ts`) persists
  the URN as the very next statement after `publisher.publish()` returns; if that specific
  write fails (e.g. an ordinary SQLite lock), the draft is locked out of the retry loop
  entirely — instead of being treated as a publish failure, which used to increment the
  normal attempt counter and let the next drain call `publish()` again on the same text.
  The owner is notified with the real URN so they can reconcile by hand. The one narrow
  window that remains: if that lockout write *also* fails (the same lock/disk condition
  still holding), the draft stays eligible and a later drain could publish it again.
  LinkedIn does not expose an idempotency key for member posts (`POST /rest/posts`), so this
  last sliver can't be made provably safe — it's documented rather than closed.

## Customising the voice

Edit [`src/generator/voice-profile.md`](src/generator/voice-profile.md). Its contents are
injected verbatim into every generation prompt (`src/generator/prompt.builder.ts`), so
whatever tone, background, and "never do this" list you put there directly shapes every
draft.

## No API keys

Generation runs entirely through your local **Claude CLI** session via the bridge
(`scripts/claude-bridge.mjs` → `src/llm/claude-cli.adapter.ts`). This project does not use,
and does not want, an `ANTHROPIC_API_KEY`. There is no code path that calls a hosted
Anthropic API — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for why a PR adding one would be
declined.

## License

MIT — see [`LICENSE`](LICENSE).
