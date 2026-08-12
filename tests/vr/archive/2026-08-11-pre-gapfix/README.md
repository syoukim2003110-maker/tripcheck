# VR baselines — pre UX-Handoff-v1.1 gap fix (2026-08-11)

These 24 shots are the visual-regression baselines as they stood *before* the
UX Handoff v1.1 gap-closing work (`632a9e2`…`e641940` and the verification
commit that follows it). They are kept as regression material, not as an
active baseline: `tools/qa/run-vr.mjs` only ever reads
`tests/vr/baselines/`.

Use them to answer "what did this screen look like before the change?" — for
example with

```
QA_MODULES=… node -e '…pixelmatch(archive, baselines)…'
```

Four shots are byte-identical to the current baselines because the Start
screen at 768 and 390 did not change (`start-{ja,en}-{768,390}`). Every other
shot changed on purpose; the intended changes are listed in the handoff
completion report:

| screen | intended change |
| --- | --- |
| `start-*-1440` | privacy chip now carries the Copy Deck sentence (`privacy.short`) |
| `resolve-*` | per-row remove control, locale-correct labels, no verdict-sounding copy |
| `plan-*` | trip stats line, "things to check" card, one-row day rail, two-number day header, recommendation rows in the timeline |
| `detail-*` | inspector last-entry / move-day controls, honest failure states, mobile sheet tri-state |
| `plan-*-1440`, `detail-*-1440` | map legend widened so the line key and pin key are readable without scrolling |
