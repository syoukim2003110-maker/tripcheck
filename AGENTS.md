# TripCheck Japan — repository guide

## Product contract

TripCheck Japan is an English-first web tool for people planning a trip to Japan.
The initial job is narrow: paste a Tokyo itinerary, find the parts that are
unlikely to work in reality, explain why, and produce a more realistic version.

Do not expand the MVP into discovery, booking, social planning, native mobile,
or multi-city planning unless a measured user need justifies it.

## Agent responsibilities

- Codex is the primary implementer, integrator, and test owner.
- Claude Code is an independent critic and reviewer. Prefer read-only review,
  adversarial test cases, and a written patch proposal. If Claude implements a
  bounded task, use a separate branch and non-overlapping files.
- Figma is the design discussion surface for flows, components, and tokens. The
  running product is the final source of truth for behavior and accessibility.
- Never ask two coding agents to edit the same files concurrently.

Recommended loop:

1. Write the acceptance criteria in an issue or `docs/product.md`.
2. Use Figma only when a visual decision is expensive to reverse.
3. Have Codex implement one vertical slice and run checks.
4. Give Claude the diff, acceptance criteria, and a request to find failures.
5. Let Codex integrate only the review points that survive verification.

## Architecture boundaries

- AI parses messy user input and writes explanations.
- Deterministic code owns feasibility rules, time arithmetic, confidence, and
  optimization. Do not let an LLM silently invent opening hours or transit time.
- External providers sit behind adapters. Product logic must not depend on one
  model vendor.
- A POI record owned by this product must include `sourceUrl`, `verifiedAt`, and
  `confidence` before it can be treated as a hard constraint.
- Google Maps Platform content must not be copied into the owned POI database.
  Persist Google Place IDs only where permitted; fetch other Google fields at
  runtime and follow the applicable attribution and caching terms.
- User-entered or unverified places are soft constraints and must be labelled as
  such in the UI.

## Initial delivery order

1. Itinerary paste and understandable result UX.
2. Structured input parser and deterministic constraint engine.
3. Verified Tokyo POI seed set derived from real user itineraries.
4. Live route and place adapters, with cost and cache controls.
5. PWA return path and pre-trip email reminders.
6. Payments and affiliates only after repeatable user value is measured.

## Quality bar

- Mobile-first, keyboard accessible, and usable without an account.
- Never present prototype estimates as verified live facts.
- Keep confidence and data freshness visible near every consequential warning.
- Run `pnpm lint` and `pnpm build` before handoff.
- Add tests around parsing and feasibility rules before wiring paid APIs.

