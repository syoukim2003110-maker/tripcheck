# The start input becomes a search field — 2026-08-13

Branch `claude/architecture-v2`, commits `9587a67`, `09ae142`, `c1ff31d`,
`<baselines>`, on top of Codex's uncommitted work at `eaab211`.

## Why this exists

Typing free-form place names and letting resolution guess produced the wrong
place too often: Google will happily rank a same-named local business above the
foreign city the traveller meant. The product owner's decision is that the
input itself becomes a search field — **type, see real candidates, choose the
one you meant** — so the exact place is settled before any planning happens.

Codex built the first version of this. This document records what was kept,
what was corrected, and the two spec items the decision overrides.

## Spec items this deliberately revises

| Item | Original | Now |
| --- | --- | --- |
| **TC-012** | 「場所解決から国を推定し、競合時のみ確認する」, acceptance 「高信頼解決時の国操作0回」 | The country is still auto-detected and still defaults to `自動判定`; it is now a **visible optional field** on Start and Resolve rather than one hidden behind the advanced disclosure. Choosing a country hard-filters the candidate search, which is what makes the search field trustworthy across borders. Zero interactions are still required. |
| **QA-010** | "no global mandatory country field" | Still satisfied — the field is never mandatory. The revision is to Rebuild Spec L1080 「国、日付、モードは既定で隠れている」, which no longer holds for the country. |
| **Copy Deck `start.help.short`** | 「1行に1か所。順番は適当で大丈夫です。」 | 「1行に1か所。入力を止めると候補が出ます。選ぶと同名の都市・店を取り違えません。」 The deck line described an input that no longer exists. The new line, and the two country-field hints, are the current source of truth for these three strings. |

Everything else in the Copy Deck remains the正本.

## Defects fixed on top of Codex's version

| # | Defect | Fix |
| --- | --- | --- |
| 1 | Autocomplete re-billed Google once per caret move inside an unchanged line — **five provider events for one typed place**, measured. | The request keys on `(query, destination, locale)` instead of a per-sync object, and answered keys are cached for the session. Same interaction: **one event**. Revisiting a line costs nothing. |
| 2 | Autocomplete drew on the `place_resolution` budget (`maxPerTrip: 36`) that the build itself needs, so typing could starve the plan — and the exhaustion message claimed the review screen still worked when it no longer did. | New `place_suggestions` operation with its own ceilings (`maxPerTrip: 60`). The message is now true. |
| 3 | The lookup lived in a leaf component, against the P0 rule that hooks own provider calls. | Moved to `app/components/planner/hooks/usePlaceSuggestions.tsx`. A contract test walks every planner component to keep it there. |
| 4 | The mixed-country guard bounced people back to Resolve with the reason announced only to screen readers. | A visible warning naming the countries found, with both ways out (pick a country, or pick Worldwide for a genuinely cross-border trip). |
| 5 | The "map unavailable" panel overflowed the 15dvh mobile strip onto the floating header. | Contained; in the timeline strip it defers to the Map tab entirely, matching how `.planner-map-empty` already behaves there. |
| 6 | A failed tile load unmounted the map surface with no way back. | The container stays mounted and a reload control appears — except after `gm_authFailure`, where retrying a rejected key only fails again. |
| 7 | The result sheet opened 42px scrolled, past its own headline, because one scroll container serves Start, Resolve and the result. | Each screen starts at its top. |
| 8 | `/api/map-embed` and `lib/google-map-embed.ts` were orphaned by the iframe removal. As a GET the route sat outside the paid-route gate while returning `GOOGLE_MAPS_BROWSER_API_KEY` in a 302 `Location`. | Removed, with its CSS and tests. |
| 9 | The always-visible country combobox pointed `aria-controls` at a listbox absent from the DOM when closed; axe flagged it on Start and Resolve. | `aria-controls` is set only while open. |

## Two checks that were passing for the wrong reason

Both were satisfied by the 42px sheet scroll in defect 7, and failed honestly
once it was fixed.

- **DoD-PLAN-1** (first two stops in the first view). Genuinely failing at
  1280×800 and 390×844 once measured from the top. The rows above the rail were
  trimmed until it holds with real margin: **ja 13px / 26px, en 13px / 11px**.
  The mobile map strip went 15dvh → 12dvh as part of this.
- **DoD-A11Y-3** (200% zoom). Asserted the first stop was already on screen in a
  400px-tall viewport — a first-view claim the DoD does not make (it says
  「機能欠損なし」). The same accidental scroll would also have masked a
  genuinely trapped timeline. It now proves the rail is reachable: scrolling
  brings the first stop fully into view, with tabs and stops present and no
  horizontal scroll. **This assertion changed; it was not relaxed.**

## Harness changes

- `offlineProviders` refuses every paid endpoint. VR and the DoD checks use it.
  Screenshots were previously calling live providers, which both spent real
  budget on every QA run and made the plan screen depend on what a provider
  answered that minute — `plan-ja-1440` differed by 0.2% and 4.5% on
  consecutive runs of identical code.
- VR waits for the map surface to reach a terminal state before shooting.
- Three consecutive full VR runs now agree: **24/24**.
- `fixtures.placeSuggestions` answers autocomplete locally, so suggestion
  counts are assertable and no QA run can spend the trip's budget.

## VR baselines

Old set archived unmodified at `tests/vr/archive/2026-08-13-pre-searchinput/`
with a per-screen account of what changed and why. New baselines were captured
only after each of the four screens was reviewed against the spec and the
prototype. All 24 were regenerated: every screen is affected by at least the
provider-determinism change, so keeping a subset would have left baselines that
could never reproduce.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 |
| `vinext build` | 0 |
| unit `.mjs` | 11/11 |
| unit `.ts` | 586/586 |
| golden feasibility | 500 scenarios, deterministic |
| E2E | 48/48 |
| VR | 24/24, stable over three runs |
| axe WCAG 2.2 AA | clean (the two `aria-valid-attr-value` notes are gone) |
| eslint | 12 errors — unchanged from the `b1eee1e` baseline |

Test count moved 589 → 586 because `tests/google-map-embed.test.ts` (7 cases)
was removed with the endpoint it covered, and 4 cases were added in
`tests/place-suggestion-cost.test.ts`.

## Known limitations

- **VR sensitivity.** A text-only change on a 1440×900 screen can fall under the
  0.3% pixel allowance. The opening-hours count change measured 0.14% at 768 and
  would have passed silently. VR is a layout guard, not a copy guard; copy is
  pinned by the source-contract tests instead.
- **The country field is a bias, not a promise.** Choosing one filters candidate
  search to that country. A genuinely cross-border itinerary needs `Worldwide`,
  which the mixed-country warning now says explicitly.
- **`aria-allowed-role`.** The start input is a `<textarea role="combobox">`,
  which ARIA-in-HTML does not strictly permit. Not flagged by the AA rule set;
  a single-line-per-place input would be the structural fix, and would change
  the whole entry model. Left as is.
- **The suggestion cache is per-session and in-memory.** A reload re-bills the
  first lookup of each line.
