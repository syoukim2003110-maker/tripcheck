# TripCheck P0 feasibility implementation report

Date: 2026-08-09  
Source: `TripCheck_Product_Engineering_Spec_v0.1_2026-08-09.md`

## Outcome

The code-implementable P0 is now an input-first itinerary feasibility checker.
It accepts a wishlist or an existing day-by-day itinerary, keeps hard facts and
uncertainty separate, builds a deterministic schedule, explains conflicts, and
lets the traveller compare and undo repairs.

This report does **not** treat synthetic tests as evidence of real-world place,
hours or transit accuracy. The empirical release gates remain listed below.

## Product scope

- English-first, with Japanese and the existing additional locale routes.
- Alpha input contract: 5–12 places per run. More than 12 is rejected with an
  explicit split instruction; no place is silently truncated.
- Core flow: **Places → Conditions → Result**.
- Food discovery, hotel comparison, trip-idea generation, affiliates and other
  non-core APIs are hidden and fail closed unless an operator explicitly sets
  `TRIPCHECK_NON_CORE_APIS_ENABLED=true`.
- AI does not own time arithmetic, feasibility, opening hours, routes, Must
  retention or optimization.

## Input and place resolution

- Parses newline, comma, slash, Japanese middle dot and bullets, plus Must,
  Optional, booking, fixed time, stay duration and Day/date headings.
- Immediate per-place chips can edit priority, booking, fixed time and stay.
- Calendar headings preserve real gaps and year rollover instead of collapsing
  dates into consecutive day numbers.
- Resolution is occurrence-based, so duplicate visits and names such as
  `Tokyo` / `Tokyo Tower` cannot be conflated by prefix matching.
- Confirmed, ambiguous and unresolved states are separate. Ambiguous candidates
  show address, country/type context and require traveller confirmation.
- One unresolved place can be corrected by manual coordinates or map pin
  without restarting the entire trip.
- Explicit ambiguity choices and manual corrections survive local restore and
  selective sharing by occurrence. Provider choices persist only the stable
  Place ID and are re-fetched with an exact Details lookup; a deleted or stale
  ID stays unresolved and never falls back to a fuzzy match. Manual corrections
  persist only the traveller-authored name, address and coordinates.
- Exact provider references survive into Place Details. User-entered coordinates
  remain `user_provided`, never provider-verified.

## Constraints and deterministic solver

- Supports date-provided and date-undecided planning, 1–14 days, per-day start
  and end, provisional base, airport boundaries, Must/Optional/booking, stay,
  last entry, locked day/order/mode, leg buffers, walking limit and transfer
  limit.
- Date-undecided plans do not apply an arbitrary weekday as hard opening-hours
  evidence and do not issue live route calls.
- Unspecified day end has one consistent, disclosed 22:00 policy across builder,
  evidence, minimum-day search and UI.
- The objective is lexicographic: hard violations, Must/booking retention,
  Optional loss, travel, slack, load and a stable final tie-break.
- A bounded deterministic day-assignment search (up to 12 stops, at most 600
  unique full evaluations) uses relocations and swaps to avoid a geographic
  seed falsely inflating minimum days. Fixed/locked days remain immovable.
- Larger in-day ordering uses bounded constraint-first insertion/relocation,
  including route buffers. A 100-run test protects determinism.
- Solver timeout/budget exhaustion returns `UNKNOWN`; it never labels a partial
  search as a minimum.
- Minimum-day assumptions come from the first actually feasible candidate, so
  dates, windows, bookings, hours and day count describe the result shown.

## Evidence and verdict contract

- `Evidence<T>` preserves `verified`, `user_provided`, `estimated`, `unknown`
  and `failed`, with source, fetch time and provider reference where applicable.
- `PlanSnapshot` includes engine version, provider snapshot hash and seed.
- Five explicit result states are implemented:
  - `VERIFIED_FEASIBLE`
  - `PROVISIONAL_FEASIBLE`
  - `FEASIBLE_IF_ASSUMPTIONS`
  - `INFEASIBLE_HARD_CONFLICT`
  - `UNKNOWN`
- Structured conflicts contain code, affected items, numeric impact and only
  evidence IDs that exist in the same snapshot.
- Pace, place count, walking and transfer preferences stay soft attention unless
  the traveller explicitly locks a hard choice.
- Typical weekly hours are estimates; date-qualified current/special hours are
  verified only inside their provider coverage range.
- Duration badges and print output distinguish estimated, traveller-set and
  confirmed values.
- Critical-fact coverage and the separate regional coverage profile are both
  shown; one is not used as a substitute for the other.

## Live provider path and cost safety

- Only selected physical legs are queried. Full route matrices are not the
  default.
- Transit evidence is bound to mode, departure bucket and request key.
- Transit re-solving stops on convergence or after three iterations; the whole
  trip is capped at 20 route request-events. Non-convergence uses the most
  conservative observed duration and remains conditional.
- Transfer counts come from transit steps. Missing step data stays unknown.
- Provider failure never becomes zero minutes and never draws a fake route line.
- Planning Place Details uses an identity/hours-only field mask. Reviews,
  photos, ratings, payment data and discovery fields are outside P0.
- Hard client limits are 20 route events, 12 place resolutions/details and 10
  hours checks. Hours are prioritized for fixed/Must items.
- An opaque per-trip request identity is stable for one trip, rotates for a new
  trip/demo/share import, and is never included in public share data.
- The Worker reserves D1 quota atomically for trip, anonymous session/day,
  global day and global month scopes. Failed attempts are charged.
- Text Search, exact Place-ID rehydration and the optional hotel share the same
  twelve-event place-resolution ceiling at both Worker and application layers;
  exact-only restores cannot bypass or be rejected by a zero-unit count.
- Paid endpoints require same-origin requests, support global/provider kill
  switches, and fail closed when D1 or the quota secret is missing.
- Google Core calls use an 8-second attempt timeout, at most one retry with
  exponential backoff and jitter, and a five-minute rolling circuit breaker
  above 50% failures. Every retry requires a second durable reservation.
- URL previews allow public HTTPS only, resolve and revalidate DNS and redirects,
  and reject private/link-local/metadata targets.

## Result, repair and accessibility

- Result begins with verdict, minimum-day premise, fact coverage and the largest
  attention item; the day timeline is the primary view.
- Day metrics expose used, available, spare and travel time.
- Existing-itinerary mode compares original, a complete minimal repair when one
  exists (otherwise truthfully “smallest improvement”), and shortest travel.
- Up to three re-solved counterfactuals show the change, before/after conflicts,
  overrun, slack, travel and loss before Apply.
- Undo/Redo stores the last 20 serializable traveller edits; provider/loading
  state is deliberately outside history.
- Result changes use a polite live region. Major controls have keyboard paths,
  focus styles and non-colour labels.
- At 320 CSS px, the tested Places and Result views have no horizontal page
  overflow. Timeline is the default mobile result and Map is a separate toggle.

## Local persistence, print and sharing

- IndexedDB stores up to ten user-authored input/edit records and excludes
  mutable provider content and built plans. Unavailable/private storage falls
  back to session memory and is reported as non-persistent.
- Recent-trip titles and removed-place labels are derived only from traveller
  input. Opening a saved trip discards all prior runtime provider state before
  exact rehydration, even when the pasted itinerary text is unchanged.
- Legacy local records migrate transactionally and are removed only after a
  successful IndexedDB write.
- Print/PDF contains verdict, assumptions, coverage, conflicts, airport notes,
  address and complete arrival/start/end/stay timing without requiring a map.
- Short share data uses a URL fragment only after a warning and lets the user
  exclude dates, base/hotel, airports and reservation details. Oversized or
  incompletely redactable payloads are blocked rather than silently weakened.

## Privacy-minimal product analytics

- The eight specified funnel milestones are implemented.
- The endpoint accepts a closed aggregate schema: counts, solver time, result
  state, provider/error category and alternative type only.
- It rejects raw text, names, addresses, dates, booking details, arbitrary
  errors, Place IDs and stable user identifiers.
- The public privacy page now discloses the aggregate events, IndexedDB limit
  and the narrower P0 provider fields.

## Automated verification

Verified on the final working tree:

- `pnpm exec tsc --noEmit`: pass
- `pnpm lint`: pass
- `pnpm build`: pass
- `pnpm test`: pass — **431/431** TypeScript tests plus **11/11** SSR/privacy tests
- golden fixture check: **500 deterministic synthetic scenarios**, current
- parser corpus: **500 deterministic synthetic cases**, F1/recall gates pass,
  measured synthetic p95 below 200 ms
- `git diff --check`: pass

The synthetic corpora protect engine/parser regressions. They are explicitly
labelled synthetic and do not prove provider or real-trip accuracy.

## Browser verification

Local interactive verification covered:

- desktop Places → resolution → Conditions → Result;
- date-undecided provisional result;
- original/minimal/shortest comparison and before/after diff;
- Apply, Undo and Redo;
- selective-share warning and field controls;
- 320 px Places and Result views, zero document-width overflow, mobile timeline
  default and readable decision metrics.

## Open release gates (not code-completable in this pass)

These remain mandatory before a public quality claim:

1. Independent, real-world 500-place benchmark: Top-1 ≥95% and wrong automatic
   confirmation ≤1%.
2. Evidence-backed real itinerary audit in addition to the synthetic 500-case
   hard-conflict corpus.
3. Target-device p50/p95 for parse, provisional, live and local recalculation;
   provider-outage completion ≥99%, crash-free ≥99.5%, unknown→verified = 0,
   cost ≤$0.30 per completed trip.
4. Automated WCAG critical issues = 0 plus manual keyboard, screen-reader,
   contrast and 320 px device review.
5. Moderated test: at least 7 of 8 users complete the primary task.
6. Private beta: at least 100 trips, no more than two severe wrong plans, then
   rerun after fixes.
7. Production operations: restricted Google keys, `DB` D1 binding,
   `TRIPCHECK_PUBLIC_ORIGIN`, a 32+ character `TRIPCHECK_QUOTA_HASH_SECRET`,
   provider quotas/alerts, kill-switch and circuit-breaker drills, dependency
   review and final Google policy review.
8. Decide and document the actual hosting operational-log retention period.

## Staged after P0

- P1: encrypted expiring share blob, PWA/offline/on-trip recovery, OCR/PDF/email
  import, weather/holiday overlays and broader accessibility profiles.
- P2/data-gated: hotel comparison, collaboration, itinerary-linked ledger and
  other modules demonstrated by measured demand.

No external Git push or production deployment was performed.
