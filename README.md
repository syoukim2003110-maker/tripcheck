# TripCheck Japan

An English-first reality checker for Japan itineraries. Paste a Tokyo plan,
identify the parts that are unlikely to work, understand the trade-offs, and
review a calmer alternative.

The current build is the first interactive vertical slice. It uses illustrative
local rules and deliberately does **not** claim live opening-hour, ticket,
weather, or transit verification.

## Run locally

Requires Node.js 22.13 or newer.

```bash
pnpm install
pnpm dev
```

## Verify

```bash
pnpm lint
pnpm build
pnpm test
```

## Repository map

- `app/` — product UI and routes
- `lib/trip-analysis.ts` — disposable local analysis used by the vertical slice
- `docs/product.md` — customer, wedge, trust model, and validation gates
- `docs/architecture.md` — target data and provider boundaries
- `AGENTS.md` — Codex, Claude Code, and Figma collaboration rules

Before connecting an AI or map provider, read the provider and data rules in
`AGENTS.md` and `docs/architecture.md`.

