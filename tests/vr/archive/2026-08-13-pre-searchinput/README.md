# VR archive — 2026-08-13, before the search-style place input

These 24 shots are the `tests/vr/baselines/` set as it stood at commit
`eaab211`, kept as regression material for the change that turned the start
input into a search field. They are **not** compared against: `run-vr.mjs`
reads only `tests/vr/baselines/`.

Two things make a direct pixel comparison with the current baselines
misleading, so read this table rather than diffing the folders:

1. The old shots were taken with paid endpoints reachable, so their plan and
   detail screens show whatever the providers answered that minute. The
   current harness refuses those calls (`offlineProviders`), which pins every
   screen to its documented degraded state.
2. The old plan and detail shots were taken with the result sheet scrolled
   ~42px down, because the sheet's scroll position carried over from the start
   screen. Their headlines are cut off; the current ones are not.

## What changed per screen, and why

| Screen | Intended change |
| --- | --- |
| `start-*` | The destination picker moved out of the advanced disclosure and is now a visible optional field above the CTA, with a hint explaining why choosing a country first sharpens the search. The input hint describes the new behaviour: pause, see matches, choose one. Approved by the product owner as a revision to TC-012 / QA-010 — see `docs/search-input-2026-08-13.md`. |
| `resolve-*` | Same destination picker, worded for re-running the current input inside a chosen country. Ambiguous rows gained a "none of these — use an address" escape hatch. The map pane shows the offline panel with its reload control instead of a broken embed frame. |
| `plan-*` | Opening hours are no longer demanded of towns, valleys and peaks, so the unverified-fact count and the "check opening hours" row shrink to the places that actually have a schedule. The result opens at its own headline instead of 42px down. On mobile the map strip is 12dvh (was 15dvh) so the first two stops finish above the fold without that scroll. The strip stays quiet when the map is unavailable — the explanation and the reload live on the Map tab. |
| `detail-*` | Inherits the plan changes; the inspector itself is unchanged. |

## Older archives

`2026-08-11-pre-gapfix/` holds the set from before the UX Handoff v1.1 gap
work. Both archives are additive; neither is ever compared automatically.
