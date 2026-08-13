# VR archive — 2026-08-13, before the Resolve map collapse

The four `resolve-*` mobile shots as they stood at commit `5123f9a`, kept as
regression material. They are **not** compared against: `run-vr.mjs` reads only
`tests/vr/baselines/`.

## Why these four moved, and only these four

At 390×844 with the map provider unavailable, the map panel filled the whole
viewport and the sheet was bottom-anchored beneath it. The list of places to
confirm started at y=760 and the first same-name question at y=883 — both below
the fold, on the screen whose entire job is answering that question. Measured on
the live DOM, not inferred from these images.

The map now collapses on mobile when it cannot load, exactly as the result
view's timeline strip already does, and the sheet takes the screen. The
confirmation list starts at y=321 and the first question at y=444. The step
indicator gained the same 78px header clearance the first step already used, so
it is no longer read through the floating topbar.

| Screen | Changed | Why |
| --- | --- | --- |
| `resolve-ja-768`, `resolve-ja-390`, `resolve-en-768`, `resolve-en-390` | yes | The collapsed map and the raised sheet, as above. |
| `resolve-*-1440` | no | Desktop keeps the map beside the sheet; the rule lives inside the mobile media query. |
| `start-*`, `plan-*`, `detail-*` | no | Untouched, and confirmed unchanged by this run. |

`P1-08 an unavailable map does not bury the confirmation list (390×844)` in
`tools/qa/run-e2e.mjs` now asserts the positions directly, so this is held by a
box measurement rather than by pixels alone.

## Older archives

`2026-08-13-pre-searchinput/` holds the set from before the start input became a
search field. `2026-08-11-pre-gapfix/` holds the set from before the UX Handoff
v1.1 gap work. All archives are additive; none is ever compared automatically.
