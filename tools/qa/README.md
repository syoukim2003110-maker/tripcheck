# TripCheck QA harness

Headless-Chrome checks for the v1.1 QA Matrix: an executable E2E slice, an
axe-core WCAG 2.2 AA scan, and a visual-regression suite. Everything runs
deterministically with **zero provider keys**: external hosts are blocked,
`/api/place-resolution` is answered with fixtures where a scenario needs
ambiguity, and the sample trip builds from bundled coordinates.

## Setup (once)

The dependencies are deliberately **not** in `package.json` — the repo's
pnpm lockfile must not drift for QA-only tooling. Install them anywhere and
point `QA_MODULES` at the resulting `node_modules`:

```sh
mkdir -p ~/tripcheck-qa && cd ~/tripcheck-qa \
  && npm i puppeteer-core@24 pixelmatch@5 pngjs@7 axe-core@4
```

Requirements: Google Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
(override with `QA_CHROME`), and the dev server on
`http://127.0.0.1:8788` (override with `BASE_URL`).

## Commands

```sh
export QA_MODULES=~/tripcheck-qa/node_modules

node tools/qa/run-e2e.mjs           # QA-002/008/009/011/021/036/037/042/043/045 + §5.2 must-confirm
                                    # + TC-056 (≥44px primary targets) + DoD-A11Y-4 (320px reflow)
                                    # + DoD-A11Y-2 (keyboard-only main flow)
node tools/qa/run-axe.mjs           # QA-046/TC-057: WCAG 2.2 AA scan, 6 surfaces, violations fail
node tools/qa/run-vr.mjs            # QA-054/TC-066: compare against tests/vr/baselines
node tools/qa/run-vr.mjs --update   # re-capture baselines after an intended visual change
```

All three exit non-zero on failure. VR diffs land in `tools/qa/vr-out/`
(gitignored output; baselines live in `tests/vr/baselines/`).

## Coverage map

| Surface | E2E | axe | VR |
| --- | --- | --- | --- |
| Start (ja/en) | QA-002 empty-input error + focus, QA-045 targets, TC-056 ≥44px CTA (1440+390), DoD-A11Y-4 320px reflow, QA-042 keyboard (Tab→sample→Enter, Cmd/Ctrl+Enter submit) | ✓ | 3 viewports × 2 locales |
| Resolve (fixture) | QA-008 only-ambiguous asks (≤3 inline candidates), QA-009 retry/edit/manual-pin, QA-011 coordinates → plan, §5.2 must-confirm dialog, QA-045, DoD-A11Y-4 320px reflow (manual pin open) | ✓ | 3 × 2 |
| Plan (bundled sample) | QA-021 day tabs, QA-036 must-removal confirm, QA-037 toast+undo, QA-043 aria-live once-per-event, QA-045 (1440 + 390), TC-056 ≥44px day tabs / mobile view toggle / meal accept, DoD-A11Y-4 320px reflow, QA-042 keyboard (arrows, meal accept toast, share dialog) | ✓ | 3 × 2 |
| Detail / bottom sheet | QA-045 desktop-inspector + 390px-sheet audits (plus plan scenarios) | ✓ | 3 × 2 — the 390px shots are the spec's "Mobile" screen |
| Must-confirm dialog | §5.2 scenario | ✓ | — |

The meal-recommendation rows in the plan scenarios are backed by a
`/api/food-recommendations` fixture (`foodRecommendationsFixture` in
`qa-lib.mjs`): candidates are generated at the slot coordinates the app asks
about, so the accept button (ここにする) exists without any provider key.
`run-e2e.mjs` documents which QA-042 pieces still require a manual pass
(live-provider place entry, gap-row accept, clipboard copy, on-device sheet
and map keyboard operation).

## Known limits

- `color-contrast` on `.planner-route-status` stays "needs manual review":
  axe cannot compute contrast through `backdrop-filter`. Manual math:
  `#3f3f3c` on ≥90% white is ≈8–10:1, passing AA.
- Rows needing real devices/browsers (QA-067 six-browser matrix) or live
  providers (Google/Rakuten verification rows) are out of this harness's
  scope by design.
