# Baselines before the Gate E first-viewport pass — 2026-08-13

The 18 shots the P2 design pass replaced, kept as the pre-change regression
material. `start-*` is not here: all six start shots are byte-identical
before and after, which is the check that the pass stayed inside the result
and confirmation screens.

Every change below is intentional and was measured on the live DOM before the
baseline was rewritten. Numbers are `.planner-stop-row` / `.planner-resolved-places`
top offsets in CSS px.

## plan-{ja,en}-390 — 13.2% / 13.6%

| | Before | After | Contract |
| --- | ---: | ---: | ---: |
| First stop top | 664 | **297** | ≤ 300 |
| Second stop bottom | 818 | **451** | ≤ 844 |
| Safe Filler top | 832 (actions off-screen) | **455** | ≤ 844 |
| Visible “things to check” summaries | 2 | **1** | ≤ 1 |

- The 12dvh map band above the timeline is gone. It rendered a ~45px sliver of
  map behind the floating header and two chips, and it cost 101px.
- The itinerary/map switch left the sheet for a fixed pill at the bottom of the
  viewport, and lost its third state: “Hide map” and “Timeline” had described
  the same screen once the band went.
- The verdict card stopped being a tile: its label row is gone (the h1 says the
  conclusion) and its one action shares a row with the one warning.
- The things-to-check card and the verdict-details disclosure moved below the
  itinerary. `docs/product.md` already said the details are "not a dashboard
  placed before the itinerary".
- The day fullness is one line — the day's own label is on the active tab
  directly above it.

## plan-{ja,en}-768 — 7.7% / 7.8%

Same DOM moves at tablet width; the verdict card keeps its tile (the strip
rules are ≤460). First stop 831 → 460.

## plan-{ja,en}-1440 — 3.8%

| | Before | After | Contract |
| --- | ---: | ---: | ---: |
| First stop top | 453 | **352** | ≤ 360 |
| Summary band above the rail | 223 + 121 issue card | **106** | ≤ 160 |

Driven by the same two moves (issue card and verdict details below the
itinerary, one-line day fullness) plus tighter strip metrics: the state icon
is 18px rather than 22px and the card's action button 38px rather than 42px.

## detail-{ja,en}-{390,768,1440} — 4.2%–7.1%

The plan screen with a stop inspector open, so it inherits every plan change.
Two inspector-specific fixes are visible at 390 and 768:

- The inspector is grouped in `.planner-map-overlay-layer` inside the map
  canvas, so the itinerary view can hide the map surface without hiding the
  sheet that sits on top of it. Hiding the canvas outright took the inspector
  with it — a latent defect in the old "Hide map" state that became reachable
  when that geometry became the default.
- The bottom pill stands down while an inspector is open; it had covered the
  sheet's own actions.

## resolve-{ja,en}-390 — 8.3% / 7.2%

| | Before | After | Contract |
| --- | ---: | ---: | ---: |
| Confirmation list top | 375 | **176** | ≤ 180 |
| First question top | 498 / 575 | **298 / 361** | in view |

“Edit input” and the country selector moved below the confirmation list: both
restart the search, so they follow what was found rather than standing between
the traveller and it. They stay above the list when the places span several
countries, because then choosing the country *is* the next action. The country
selector remains permanently visible either way (2026-08-13 product decision);
only its position moved.

The step heading is 22px rather than 27px at ≤840 — a step heading, not the
Start screen's hero — and the sheet's grab handle is gone on this screen,
where the sheet fills the viewport and has nothing to drag back to.

## resolve-{ja,en}-768 — 12.5% / 12.4%

Same reorder; the larger ratio is only because the two moved blocks are a
bigger share of a narrower single-column layout.

## resolve-{ja,en}-1440 — 2.3% / 2.5%

The reorder alone. Desktop keeps its heading scale and its top padding.

## Unintended changes found and reverted before these baselines were written

- The Start screen shifted up 24px at 768 and 390. The Resolve padding rule
  shared its selector list with `.trip-planner-app.is-places .planner-form-view`,
  so tightening one tightened both. Split; all six start shots are now
  byte-identical to their previous baselines.
