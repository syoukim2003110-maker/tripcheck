# Baselines before the meal and spare-day pass — 2026-08-13

The 8 shots this pass replaced, kept as the pre-change regression material.
`start-*` and `resolve-*` are not here: all twelve are byte-identical before
and after, which is the check that the pass stayed inside the result screen.
`detail-{ja,en}-{768,390}` are not here either — the inspector covers the part
of the timeline that changed at those widths, so they still match their
existing baselines and were deliberately left alone rather than swept up by
`--update`.

Two intentional changes, both verified against the live DOM and against
`docs/product.md` before the baselines were rewritten.

## The 18:00 dinner Filler row — plan-{ja,en}-{1440,768,390}, detail-{ja,en}-1440

The sample trip is a Swiss itinerary whose day 1 route finishes before 16:00
under a 22:00 curfew. Switzerland's dinner window opens at 18:00, and the old
rule (`lastDeparture < dinner.start - 120`) asked when *sightseeing* ends
rather than when the *day* ends — so the day with the most room for dinner was
the one that lost the slot. It now has one, and the row sits above the
「ホテルへ 電車 約95分」 return leg, which is where the meal falls.

The row shows its unavailable state (「夕食候補を取得できませんでした」 /
"Dinner suggestions did not load", with a retry) because the harness aborts
every non-`BASE_URL` request, so Places cannot answer. That is the same
convention the baseline already used for the hotel shortlist on this screen —
the honest failure state, not an invented candidate.

## The trip stats line — same 8 shots, y≈109–121

| | Before | After |
| --- | --- | --- |
| ja | 8か所・移動14時間55分・**余裕22時間** | 8か所・移動14時間55分・**1日分の空き** |
| en | 8 places · 14h 55m travel · **22h buffer** | 8 places · 14h 55m travel · **1 day spare** |

The assessment has always computed `spareDays` and nothing read it. Both
figures describe the same spare time; when it amounts to whole days, the day
count is the honest resolution — 「余裕22時間」 reads as *comfortable* when it
means *a whole day of this trip has nothing in it*.

The clause **replaces** the buffer clause rather than joining it. Appending a
fourth clause wrapped the line to two rows and pushed the first stop from
y=297 to y=316, breaking the Gate E contract (`≤ 300`); the E2E ratchet caught
it. Swapping keeps the line one row and the first stop at **y=297**, unchanged
in both locales.
