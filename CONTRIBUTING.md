# Contributing to bitacora

## Running tests

```bash
npm install
cp .env.example .env           # prisma needs DATABASE_URL to resolve prisma.config.ts
npx prisma generate
npm test                       # unit + integration + e2e specs
npm test -- --coverage         # same, with the coverage gate (80% lines/statements)
npx jest test/e2e               # just the end-to-end cycle test
```

Repository-level specs that touch SQLite (`*.spec.ts` under `src/persistence`,
`src/publisher/linkedin/token.store.spec.ts`, and `test/e2e/full-cycle.e2e-spec.ts`) each
create and tear down their own throwaway database file under `data/`. They resolve that
path with `join(process.cwd(), 'data', '<name>.db')` rather than a relative `file:` URL —
Prisma resolves relative sqlite URLs against `prisma/schema.prisma`'s directory, not the
process's working directory, so a relative path silently points somewhere else and leaks
rows between runs. Follow that pattern for any new database-backed test.

`npm run lint` and `npx tsc --noEmit` should also be clean before you open a PR; CI runs
both.

## TDD is the expectation, not a suggestion

Most of this codebase was built test-first: a failing spec, then the minimal
implementation that makes it pass. That is verifiable for the bulk of the history, but not
for the first two tasks — their commits landed squashed, so red-before-green can't be
confirmed from the git log for that early slice. New contributions should follow the
red-green-refactor loop regardless — rather than writing implementation first and
back-filling tests. If you're adding behavior, we want to see the test that would have
failed against the old code.

## Adding adapters

`bitacora` is built around ports (`src/core/ports/`) so that the pieces that touch the
outside world are swappable:

- **`LlmPort`** (`src/core/ports/llm.port.ts`) — anything that turns a prompt into text.
  The only shipped implementation talks to a local Claude CLI bridge
  (`src/llm/claude-cli.adapter.ts`). A `LlmPort` adapter for another **local, non-API**
  model runner (Ollama, LM Studio, a different CLI you already have a subscription to) is
  welcome.
- **`PublisherPort`** (`src/core/ports/publisher.port.ts`) — anything that takes a post body
  and returns a URN. The only shipped implementation is LinkedIn
  (`src/publisher/linkedin/linkedin.publisher.ts`). Adapters for other platforms (Mastodon,
  Bluesky, a personal blog's API) are welcome.
- **`SourcePort`** and **`ReviewChannelPort`** are the other two seams, for new signal
  sources and new review/approval channels respectively.

Open an issue describing the adapter before investing time in a large PR, so we can agree
on shape up front.

## What will be declined

**A PR that adds an Anthropic API adapter (i.e. anything that reads `ANTHROPIC_API_KEY` or
calls `api.anthropic.com`) will be declined.** This is deliberate, not an oversight: the
project exists to run entirely on a developer's own local Claude CLI subscription, with no
API billing and no API key ever touching this codebase. See
[`docs/bridge.md`](docs/bridge.md) for the reasoning. If you want LLM-provider flexibility,
the right shape is a new `LlmPort` adapter for another **local** tool — see above.

## Code style

Match the existing codebase: strict TypeScript, no `any`, immutable updates (spread rather
than mutate), small focused files, ports/adapters over direct coupling to a specific vendor
SDK. `eslint.config.js` and `tsconfig.json` are the source of truth for what's enforced.

## License of contributions

This project is licensed under the **Apache License 2.0** ([`LICENSE`](LICENSE)). Per
section 5 of that license, any contribution you intentionally submit for inclusion — a pull
request, a patch on an issue — is licensed under the same terms, with no additional
conditions. There is no separate CLA to sign.

Don't add a copyright header claiming exclusive ownership of a file you edited, and don't
alter the [`NOTICE`](NOTICE) file. If a contribution brings in third-party code, say so in
the PR and name its license: anything incompatible with Apache-2.0 (notably GPL-licensed
code) can't be merged.
