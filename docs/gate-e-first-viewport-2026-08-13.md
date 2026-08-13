# Gate E — the result screen leads with the itinerary

The one gate the 298646d remediation left open, closed here. Branch
`claude/architecture-v2`, on top of `fdfc44e`.

`TripCheck_P2_Gate_Decision_298646d.md` scoped the P2 pass to visual tokens,
component spacing, typography and responsive layout, and named five checks:

| Gate E | Before | After | Contract |
| --- | ---: | ---: | ---: |
| 390×844, first stop top | 664 | **297** | ≤ 300 |
| First two stops + safe Filler inside the first viewport | filler cut off at 832, its actions at 907 | **297 / 393 / 455–584** | inside 844 |
| Visible warning-summary repetition | 2 | **1** | ≤ 1 |
| Resolve, map unavailable, review form top | 375 | **176** | ≤ 180 |
| 1440, first stop top | 453 | **352** | ≤ 360 |
| live E2E, axe AA, VR | — | **53/53, clean, 24/24** | reproduced |

Every number is measured on the live DOM in both locales, not inferred from a
baseline. English and Japanese land on the same values.

## What was actually in the way

The remediation record said this was "an information-hierarchy change to the
result header". Measuring it showed the header was the smaller half. On a
390×844 screen, 664px sat above the first stop:

| Band | px | What happened to it |
| --- | ---: | --- |
| Map preview strip | 101 | Removed from the itinerary view |
| Itinerary/map switch | 52 | Left the sheet; fixed pill at the bottom |
| Headline block | 123 | 65 — the duplicated issue chip is gone |
| Verdict card | 109 | 52 — no tile, no label row, action shares the warning's row |
| Things-to-check card | 123 | Moved below the itinerary |
| Day tabs | 51 | 47 |
| Day fullness | 65 | 21 — one line |
| Hotel departure leg | 34 | 34 |

Two of those are structure, not spacing, and they are what made the contract
reachable at all. Arithmetic on the rest lands at 316 in the best case.

### The map band cost 101px to show a 45px sliver

`is-mobile-timeline` kept the map as a 12dvh strip above the sheet. At 390×844
that is 101px, and the floating header is 56px of it, with the legend chip and
the route-status chip over most of the rest. The visible map was a ~45px band.
The comment defending the strip said it "still carries the route status, the
legend toggle and the map chips" — all three are overlays that can live
anywhere, and the map underneath them could not be read.

A band short enough to fit inside the contract is entirely hidden behind the
floating header, and a band tall enough to be worth its space pushes the
itinerary past the fold. So the itinerary view carries no map, and the Map tab
carries the map at the only width at which it is legible on a phone.

**This changes `docs/product.md`.** The old line — "the map remains above the
timeline at no more than 35% of the viewport and can be collapsed" — described
a layout that cannot also satisfy "first stop by y=300". The line is rewritten
to say what the screen now does and why. Nothing else in the contract moved:
the timeline was already required to be usable without the map, and every map
affordance still has a timeline equivalent (the hotel row, the recommendation
rows, the per-stop Google Maps link).

`MobileResultView` loses `"compact"`. "Hide map" and "Timeline" described the
same screen once the band was gone, and a three-way switch whose first two
states are indistinguishable is worse than a two-way one.

### The report was printed before the thing it reports on

`docs/product.md` already said it: evidence counts, coverage, assumptions and
counterfactuals "are not a dashboard placed before the itinerary". They were.
`TripSummaryCard` rendered the verdict strip *and* the whole Verdict details
disclosure, above the timeline, and the things-to-check card sat between them
and the plan.

`TripSummaryCard` is now the strip; `VerdictDetails` is a separate component
rendered under the itinerary, next to the things-to-check card. That is 123px
off mobile and 38px off desktop, and it makes the disclosure visible on phones
for the first time — it used to be `display: none` at ≤460px, reachable only
through the overflow menu.

## The other four changes

**One warning summary.** `確認したいこと N` was printed twice: a chip under the
headline and the card's own heading, for the same two things. The chip is gone.
The headline sentence carries the count in the conditional state, the primary
warning line carries the warning, and the card carries the list and the
actions. The E2E check that allowed two now allows one.

**The verdict card stopped being a tile on phones.** Its own background,
border, padding and margins were 34px of chrome around a label
(`旅程の結論`) that restated the h1 directly above it. What is left is one row:
the warning, and the single action that follows from the cause, side by side.
The `結論の詳細` disclosure that used to close the card went with the details.

**The day fullness is one line.** The section stacked the day label — already
on the active tab immediately above — over a 24px display number over the time
bar. Which day, how many stops, how much slack, and the bar, on one row.

**Resolve.** "Edit input" and the country selector both restart the search, so
they follow the list of what was found instead of standing between the
traveller and it — 139px above it. They keep their place above the list when
the places span several countries, because then choosing the country *is* the
next action. The country selector stays permanently visible either way
(2026-08-13 product decision); only its position moved. The step heading is
22px rather than 27px at ≤840 — a step heading, not the Start hero.

## Defects found while doing this

Three, none of them named by the review:

1. **Hiding the map canvas hid the stop inspector.** The inspector is rendered
   inside `.planner-map-canvas`, so `display: none` on the canvas took the
   inspector with it. This was already true of the old "Hide map" state, where
   nobody met it; it became the default here. The inspectors are now grouped in
   `.planner-map-overlay-layer`, and the itinerary view hides the map surface
   around it rather than the whole canvas. Caught by
   `TC-056 primary targets ≥44px (mobile sheet controls)`.
2. **The bottom pill covered the inspector's own actions.** It stands down
   while a sheet is open.
3. **The Start screen shifted up 24px at 768 and 390.** The Resolve padding
   rule shared its selector list with `.trip-planner-app.is-places
   .planner-form-view`. Caught by VR — four start baselines failed that had no
   business changing — and split. All six start shots are byte-identical to
   their previous baselines.

## Tests

No existing test was deleted or weakened.

| Test | Change |
| --- | --- |
| `P1-08 the plan's itinerary does not sink further down the screen` | Was a ratchet holding y≤680 while the work was outstanding, and named 300 as the target in a comment. Replaced by `Gate E the plan opens on the itinerary`, which asserts the contract — first stop ≤300 at 390 and ≤360 at 1440, both stops and a safe Filler inside the viewport, and the warning summary printed once instead of twice. Runs in both locales. |
| `P1-08 an unavailable map does not bury the confirmation list` | Accepted a list top of ≤400, my own number. Now asserts the audit's ≤180 and requires the first question to *end* inside the viewport rather than merely start there. Runs in both locales. |

Three checks became five; every threshold tightened.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 |
| `vinext build` | 0 |
| unit `.mjs` | 11/11 |
| unit `.ts` | 655/655 |
| golden feasibility | 500 scenarios, deterministic |
| E2E | 53/53, twice |
| VR | 24/24, twice — 18 intended, 6 byte-identical |
| axe WCAG 2.2 AA | clean |
| eslint | 12 errors — unchanged `b1eee1e` baseline, none in the files touched |

Old baselines and a per-screen account of every changed pixel are in
`tests/vr/archive/2026-08-13-gate-e-first-viewport/`.

## Known limitations

- **Headroom is thin on mobile.** 297 against a 300 contract, on the sample
  plan in both locales. A longer verdict headline — three lines instead of two
  — would put it over. The E2E check is what catches that, and it now fails
  rather than ratchets.
- **The hotel departure leg is 34px of the budget.** `ホテルから 徒歩 約5分`
  renders above the first stop whenever a base exists, provisional or not.
  Leaving it there was deliberate: it is a leg, and legs render between rows
  everywhere else. Folding it into the first stop row would buy 34px by
  changing what the measurement measures, which is not the same as earning it.
- **The Resolve rows are cramped in English at 390px.** The
  Normal/Must/Optional and Remove controls hold their width, so a place name
  wraps to four or five lines. Pre-existing and unchanged by this pass —
  identical in the archived baselines — but it is the next thing worth fixing
  on that screen.
