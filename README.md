# TripCheck Japan

An English/Japanese Japan trip builder and route optimizer. Add places in any
order, choose the number of days, and get geographic day groups, an efficient
visit order, planning times and walking/train/taxi comparisons. A timed
itinerary remains supported as a secondary checker input.

Optional hotel and flight inputs affect the result: recognised Tokyo hotel
areas become the start and end of each day, alternative areas are ranked by the
wishlist's total route distance, and Haneda/Narita buffers constrain the first
and last day.

The current build resolves places across Japan through Google Places, clusters
and orders stops locally, retains unresolved entries and checks explicit time
gaps without AI. Stay durations and schedule constraints remain deterministic.
Google Maps draws mode-aware routes, and the explicit field check organizes
listing evidence with rules before optionally searching cited public sources.

## Run locally

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local`. Use a referrer-restricted browser key for
Maps JavaScript and Maps Embed, and a server-only Places key for place
resolution. A separate server-only Routes key is optional when the Places key
is also allowed to call Routes. Set low daily quotas before use. Anthropic is
used only for optional food comparison and on-demand cited public-web search.

## Verify

```bash
pnpm lint
pnpm build
pnpm test
```

## Repository map

- `app/` — product UI and routes
- `lib/trip-analysis.ts` — disposable local analysis used by the vertical slice
- `lib/route-optimizer.ts` — local POI resolution and deterministic route ordering
- `lib/trip-builder.ts` — day clustering, hotel-base routes and airport boundaries
- `lib/time-feasibility.ts` — local timed-stop parsing and buffer calculation
- `docs/product.md` — customer, wedge, trust model, and validation gates
- `docs/roadmap.md` — five-module north star and unlock/continue/scale/kill gates
- `docs/privacy.md` — itinerary threat model and permitted processing boundary
- `docs/architecture.md` — target data and provider boundaries
- `AGENTS.md` — Codex, Claude Code, and Figma collaboration rules

Before connecting an AI or map provider, read the provider and data rules in
`AGENTS.md` and `docs/architecture.md`.
