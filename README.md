# TripCheck

An English-first itinerary feasibility checker, currently quality-scoped to a
5–12 place Tokyo alpha. Paste places in any order—or paste an existing timed
itinerary—and TripCheck calculates what fits, which hard constraint fails, the
minimum days under explicit assumptions, and up to three comparable repairs.

Dates, per-day windows, a hotel/base, airport boundaries, Must/Optional visits,
bookings, stay duration, locked order/mode, buffers and mobility preferences
feed one deterministic engine. AI does not own coordinates, time arithmetic,
opening hours, routes, feasibility or optimization.

The browser resolves unknown names through protected Google Places endpoints,
then produces a deterministic provisional result. Only the selected places and
physical route legs are live-checked. Every consequential fact stays labelled
confirmed, traveller-provided, estimated, unknown or failed. Worldwide inputs
remain available as an explicitly graded preview; they do not inherit Tokyo's
quality claim.

Food discovery, hotel comparison, trip-idea generation and other non-core
experiments are outside the P0 flow and their server routes fail closed unless
an operator explicitly enables them.

## Run locally

Requires Node.js 22.15 or newer (the test runner uses `module.registerHooks`).

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local`. Use a referrer-restricted browser key for
Maps JavaScript/Embed and server-only Places/Routes keys. Paid requests require
the D1 `DB` binding, `TRIPCHECK_PUBLIC_ORIGIN`, and a random server-only
`TRIPCHECK_QUOTA_HASH_SECRET` of at least 32 characters. Keep provider quotas
and the included global/provider kill switches configured before public use.

Anthropic remains outside Core and fully paused unless
`ANTHROPIC_REQUESTS_ENABLED=true` is set exactly. Non-core server routes also
require `TRIPCHECK_NON_CORE_APIS_ENABLED=true`; storing a key alone enables
nothing.

Core planning has durable trip/session/day/month counters, bounded retry and a
rolling provider circuit breaker. Returned Google content stays in page memory;
device-local saves contain only traveller-authored inputs/edits and permitted
stable references, never mutable listing or route responses.

### Local AI without API credits

`pnpm ai:local` starts a localhost stand-in for the Anthropic Messages API
that answers with the Claude Code CLI (`claude -p`), including an emulated
web-search tool for the cited field check. Point the app at it with

```
ANTHROPIC_API_KEY=local-claude-cli
ANTHROPIC_BASE_URL=http://127.0.0.1:8791
ANTHROPIC_REQUESTS_ENABLED=true
```

Request and response shapes are identical to production, so every AI feature
exercises its real code path; per-call timeouts stretch automatically while a
base-URL override is active because CLI answers take tens of seconds.

## Verify

```bash
pnpm lint
pnpm build
pnpm test
```

## Repository map

- `app/` — product UI and routes
- `lib/route-optimizer.ts` — local POI resolution and deterministic route ordering
- `lib/trip-builder.ts` — day clustering, hotel-base routes and airport boundaries
- `lib/planning-live-routes-client.ts` — coordinate-only route enrichment
- `lib/weather.ts` — bounded forecast-horizon weather adapter
- `docs/product.md` — customer, wedge, trust model, and validation gates
- `docs/roadmap.md` — five-module north star and unlock/continue/scale/kill gates
- `docs/privacy.md` — itinerary threat model and permitted processing boundary
- `docs/architecture.md` — target data and provider boundaries
- `AGENTS.md` — Codex, Claude Code, and Figma collaboration rules

Before connecting an AI or map provider, read the provider and data rules in
`AGENTS.md` and `docs/architecture.md`.
