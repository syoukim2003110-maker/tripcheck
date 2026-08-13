# The trip that is half empty, and does not say so — 2026-08-13

Branch `claude/architecture-v2`, on top of the P2 hardening pass in `3915d27`.

This is the product's own P2 — hotel, meal and detour recommendations — and it
starts from the reason those exist at all: 「主要スポットだけでは一日が埋まらず、
空き時間ができる」. The recommendation layer is what turns a wishlist into a
usable day. So the question was not "are the recommendations good" but "does a
real trip come out full".

## What a real trip actually looks like

Ten ordinary Tokyo places, a Shinjuku base, the default pace, run through the
real builder and fit assessment (`lib/trip-builder.ts`, `lib/trip-scenarios.ts`):

| Days | Day 1 ends | Slack per day | Gaps found | Gap surfaced | Meal slots |
| ---: | --- | ---: | ---: | --- | --- |
| 3 | 16:55 | 280–385 min | 1 | the only one | lunch only |
| 4 | 14:40 | 395–445 min | 1 | the only one | lunch only |
| 5 | 12:55 | 465–525 min | 1 | the only one | lunch only |

The four-day version is four half-days. The assessment knows it — it returns
`minimumDays: 2, spareDays: 2` — and the whole product's answer to a 410-minute
hole is one micro-stop labelled 「410分の空き時間に寄れます」, next to no dinner
at all.

Three things were wrong, and each one is small.

## 1. Dinner disappeared exactly when there was most room for it

`buildFoodRecommendationSlots` skipped dinner when
`lastDeparture < dinner.start - 120`.

Measured: three Tokyo places, 09:00–15:00, curfew 22:00. Japan's dinner window
opens at 17:30, so the cutoff is 15:30 and the day lost its dinner slot **by
thirty minutes** — with seven hours of day left.

The rule asked when *sightseeing* ends. Its comment says why it exists ("a
morning-only day cannot grow an 18:00 「帰路の夕食」 row below its 10:42
finish"), which is a real concern, but 15:00 is not morning and the day's own
end was already known: `day.deadline` is set on every day, from the airport
cutoff or the 22:00 curfew. So the day's end decides, and the last-departure
heuristic only stands in when no end is known.

The opposite case turned up in the same probe and is also fixed. A booked
16:00 anchor produces a 16:00–21:55 route, which covers Japan's entire
17:30–21:00 window — and the old formula clamped dinner to 21:00, i.e. proposed
a meal for a moment the traveller is inside a museum. A route that brackets the
whole window now gets no dinner slot rather than an impossible one.

## 2. The surfaced gap was the first one, not the one worth filling

`primaryRecommendationGap = activeDayGaps[0]` — position, not value.

A day with a 35-minute wait before its first stop and a six-hour hole after its
last one offered a cafe for the 35 minutes and said nothing about the
afternoon. `primaryItineraryGap` picks the largest instead, with visit order
breaking ties so the choice is stable across rebuilds. The per-day cap of one
is unchanged; the 120+ band already opens the normal tourist-spot categories,
so a large hole gets a real attraction rather than a coffee.

The choice moved out of the React hook into `lib/gap-detection.ts`, which is
also what made it testable.

## 3. `spareDays` was computed, tested seven times, and read by nobody

`assessTripFit` has always returned it, correctly withheld (`null`) whenever a
place is unresolved or the trip does not fit. Production never referenced it —
verified by grepping the whole repo: seven hits in `tests/`, one type, one
assignment.

Meanwhile the trip totals line said 「余裕22時間」. That is the same spare time
at a lower resolution, and at that resolution it reads as *comfortable* when it
means *a whole day of this trip has nothing in it*. The line now says
「1日分の空き」 / "1 day spare" **instead of** the buffer clause.

Instead of, not as well as — and that is not a style choice. Appending a fourth
clause wrapped the line and pushed the first stop from y=297 to y=316, breaking
the Gate E contract (`≤ 300`). The E2E ratchet from the previous pass caught it
on the first run. Swapping keeps the line one row: the first stop stays at
**y=297** in both locales.

## Hotel: audited, and left alone

The hotel surfaces were checked against the same contract and needed no change:

- ranking is against **whole-trip travel on a really built plan**
  (`rankHotelCandidates` → `builtPlanTravelMinutes`), not straight-line
  proximity;
- `hotelRebaseIsWorthwhile` already implements the exact spec threshold —
  a resolved hard conflict, ≥60 saved minutes, or ≥15% less travel — and a
  provisional base is the only one moved for free;
- every candidate is solved through the same hard-constraint gate a manual
  hotel swap runs, so an automatic pick can never make a booking late;
- the price axis is deliberately dead (`valueId` is always null) because no
  dated, comparable availability source exists, and the purpose selector offers
  the three axes that can be computed rather than one that cannot.

Manufacturing work here to make the pass look symmetrical would have meant
inventing a value signal the product has correctly refused to claim.

## One harness fix, no assertion touched

`QA-045 mobile sheet targets` and `TC-056 mobile sheet controls` started
failing, and the cause was not the product. `auditPrimaryTargets` centres every
node it measures; with a second meal row on the page it left the timeline
scrolled so the first stop row sat **under the sticky day rail** — still inside
the viewport, so the click was not scrolled first and landed on a day tab
(`document.elementFromPoint` returned `BUTTON.is-day-3`, and the active tab
had changed to day 3).

That is one check inheriting another's side effect. The scroller is reset
before the click now, so the check starts where a traveller opening a stop
starts. Nothing about what it asserts changed.

A `scroll-margin-top` fix for the sticky rail was written, measured, and
**reverted**: the app's own `scrollIntoView` calls use `block: "center"`, which
already clears the rail, so it would have been speculative CSS for a defect
that could not be demonstrated.

## Spec changes

Both are in `docs/product.md`, in the v0.3 contract section.

| Change | Why | Tests |
| --- | --- | --- |
| A day gets a meal slot when the **day** is still running at that hour, not when its last visit is; a route bracketing the whole window gets none | The old rule cost dinner on ordinary early-finishing days, and proposed impossible ones on late days | No existing test asserted either case. Three added to `tests/trip-builder.test.ts`, including one pinning the pre-existing airport-deadline rule that had to survive |
| A day surfaces its **largest** gap, not its first | Answering a 35-minute wait while a six-hour hole goes unmentioned is not what the cap was for | Two added to `tests/gap-detection.test.ts` |
| The totals line states spare days **in place of** total buffer | Same fact, honest resolution — and it is what keeps the line one row inside the first-viewport contract | The existing deck-form assertion is untouched and still passes; two added to `tests/timeline-presentation.test.ts`, one of which pins that the swapped line is never longer than the line it replaces |

No existing test was deleted, relaxed or rewritten.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 |
| `vinext build` | 0 |
| unit `.mjs` | 11/11 |
| unit `.ts` | 683/683 (was 676; +7, none removed) |
| golden feasibility | 500 scenarios, deterministic |
| E2E | 53/53 |
| VR | 24/24 — 8 baselines intentionally moved, 16 byte-identical |
| axe WCAG 2.2 AA | clean |
| eslint | 7 errors / 3 warnings — unchanged |

The 8 moved baselines are archived with their before/after in
`tests/vr/archive/2026-08-13-pre-dinner-slot/`. Four `detail-*` shots that
`--update` had swept up despite passing were restored: only screens with a real
change moved.

## What this does not do

- **It does not fill the hole.** A four-day trip with two spare days now says
  so and points its one suggestion at the biggest gap in the day. Turning that
  into a full day means proposing several stops at once, which is a different
  contract (the per-day cap is one) and a different conversation about how much
  the product decides for the traveller.
- **`selectDailyDefaultRecommendations`, `shortlistRecommendations` and
  `acceptRecommendation` are still production-dead.** They implement the
  one-lunch/one-dinner/one-micro cap and the one-default-two-alternatives rule
  that production enforces through a separate path
  (`reserveDistinctRecommendationCandidates` plus the per-day gap cap). The
  caps do hold; they hold twice, in two places. That is duplication to
  consolidate, not a defect to fix, and it was left out of a pass whose
  changes had to stay individually verifiable.
- **The meal slot's search position is unchanged.** `positionAtMealTime`
  already puts the search where the traveller actually is at that hour,
  including the midpoint of the hotel return for a post-route meal.
