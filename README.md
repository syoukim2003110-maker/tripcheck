# TripCheck Japan

An English-first Tokyo trip builder and route optimizer. Add places in any
order, choose the number of days, and get geographic day groups, an efficient
visit order, planning times and walking/train/taxi comparisons. A timed
itinerary remains supported as a secondary checker input.

Optional hotel and flight inputs affect the result: recognised Tokyo hotel
areas become the start and end of each day, alternative areas are ranked by the
wishlist's total route distance, and Haneda/Narita buffers constrain the first
and last day.

The current build recognises a small source-attributed Tokyo catalog, clusters
and orders known stops locally, retains unresolved entries and checks explicit
time gaps without AI. Stay durations, walking and taxi minutes are visibly
labelled planning estimates. An opt-in Google Routes adapter can replace public
transport estimates with a fresh scheduled result; opening hours, ticket
availability, weather and taxi traffic are not yet live.

## Run locally

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev
```

Live transit requires a Google Cloud project with Routes API and billing
enabled. Copy `.env.example` to `.env.local`, set `GOOGLE_ROUTES_API_KEY`,
restrict the key to Routes API and set a low daily quota before use. Never put
the key in a browser-exposed environment variable.

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
