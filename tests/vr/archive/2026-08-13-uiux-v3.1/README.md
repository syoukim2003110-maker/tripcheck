# Baselines before the UI/UX v3.1 pass — 2026-08-13

All 24, because v3.1 changed the type scale and every screen carries type.
Kept as the pre-change regression material; the pass itself is recorded in
`docs/uiux/implementation-2026-08-13.md`.

## Intended changes

Every screen, all widths, both locales:

- **Type scale.** No traveller-facing text below 12px any more (258 of 374
  `font-size` declarations used to be, 61 of them below 10px). Stop names
  14.5px → 17px; the result headline 22px → 34px on desktop.
- **Radii.** 15 distinct values → 3 (10 control / 14 card / 999 pill).

`plan-*` and `detail-*`:

- **The strip between the headline and the day rail is gone.** It used to hold
  the label 「旅程の結論」 — which the headline already says — over two lines of
  arithmetic and a button on its own row. The arithmetic moved into 結論の詳細,
  under the itinerary it explains. What is left is the one warning and its one
  action, closed by a hairline.
- **The verdict eyebrow (「条件付き」/"Conditional") is gone**; the state now
  rides as a coloured mark beside the headline sentence. The eyebrow still
  renders for the one thing the sentence does not say — that some of the
  traveller's own places did not fit.
- **The warning names a place instead of counting facts**: 「未確認の重要情報が
  10件あります」 → 「インターラーケンほかは出発前の確認が必要です。」
- **Stay lines carry their own confidence**: 「滞在90分 [推定]」 →
  「滞在の目安 1時間30分」. The 推定/確認/指定 badge moved into the stop
  sheet's new evidence disclosure.
- **Day tabs are day-coloured pills** (filled when open, outlined otherwise);
  the numbered badge beside the label is gone. At 390px all four days now fit
  without scrolling the rail.
- **Stop markers are the open day's colour**, matching their map pins.
- **Movements are cards**: mode mark, 「電車 95分・乗換1回」, the segment
  (A → B) and a chevron. The segment and the transfer count used to live only
  in an aria-label and inside the disclosure.
- **Unfilled meal slots are one line** with their retry beside them, instead of
  a 125px dashed box holding an apology. The Filler label stays — a slot
  TripCheck opened must not read like a place the traveller asked for.

`detail-*` additionally:

- The sheet is an information sheet, not a form. **「営業時間・根拠を見る」**
  and **「この場所の条件を変える」** are new disclosures; the stay select and
  last-entry input moved into the second one. 「日を移動」 stays on the surface.
- The destructive control stays last (TC-053 §9.2) — this is a deliberate
  divergence from the handoff's own mock, which puts it higher.

`start-*`:

- **The primary CTA is accent red** (this supersedes v1.1's black CTA), with a
  background halo and a lift so the docked button reads as a dock rather than a
  block that landed on the form.

- **The preview is a day-by-day sample**, not an abstract shape: four numbered
  days in the day palette with where each night is spent and where lunch falls,
  beside the route illustration. Labelled as a sample in its own heading.
- **Day-length tiles are named and checked** (「3日/4日/5日/未定」 with an accent
  check on the chosen one) rather than bare numerals inverted to a solid block.

The step rail is unchanged: hiding it on step one was implemented, broke
`tests/rendered-html.test.mjs`, and was reverted rather than argued with. The
handoff's Start mock has no step rail, but it also has no place-resolution
step, so it is not evidence that the rail is noise.

`resolve-*`:

- **A place in review takes the whole row for its question.** The candidate
  buttons were rendering 78px wide, wrapping a Swiss address into fourteen
  lines, because the question shared a grid row with the priority picker and
  the remove button. Now 300px wide and 46px tall. This was a real pre-existing
  defect; the v3.1 type scale is what made it fatal (the question block grew to
  818px and could not fit any viewport, which is how Gate E caught it).

## Unintended changes

None found. One regression was caught and fixed before these baselines were
written rather than being accepted into them:

- `.planner-result-decision span { text-transform: uppercase }` — a leftover
  from the removed eyebrow — was uppercasing the English warning sentence that
  moved into that container (「INTERLAKEN AND OTHERS NEED A CHECK BEFORE YOU
  GO.」). The rule is deleted.

## What was checked, and how

Reviewed by eye at every width and in both locales: `plan-ja-{1440,768,390}`,
`plan-en-1440`, `detail-ja-{1440,390}`, `detail-en-{1440,390}`,
`start-ja-{1440,390}`, `resolve-ja-390`. The remaining shots are the
locale/width twins of those and were accepted on the strength of the geometric
checks rather than a second look: E2E 53/53 including the Gate E first-viewport
contract at 390 and 1440 in both locales, and an axe WCAG 2.2 AA scan with no
violations.
