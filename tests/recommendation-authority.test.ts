import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// TC-049 (spec §6.2/§13.4): the AI's authority in recommendation ranking is
// label-only. Deterministic scorers decide the display order AND the
// lead/selected candidate; the AI contributes short comparison labels
// attached to the candidates it was given — arriving late, labels attach in
// place without reordering. These source contracts pin the client surfaces
// that previously let the AI reorder shortlists or swap the selected base.

const foodSource = readFileSync(new URL("../app/components/planner/hooks/useFoodAndGaps.tsx", import.meta.url), "utf8");
const hotelSource = readFileSync(new URL("../app/components/planner/hooks/useHotels.tsx", import.meta.url), "utf8");
const buildSource = readFileSync(new URL("../app/components/planner/hooks/usePlanBuild.tsx", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../lib/planner-app-state.ts", import.meta.url), "utf8");

test("the food AI attaches labels without deciding the display order or the lead", () => {
  // The AI request stays (labels are wanted)…
  assert.match(foodSource, /requestFoodRanking\(/);
  // …its notes attach to the matching candidate ids…
  assert.match(foodSource, /const notes = Object\.fromEntries\(ranking\.ranked\.map\(\(item\) => \[item\.id, \{ reason: item\.reason, tag: item\.tag \}\]\)\)/);
  // …and no ordering authority remains: no rank map, no candidate re-sort,
  // no aiOrdered flag marking an AI-owned order.
  assert.doesNotMatch(foodSource, /ranking\.ranked\.map\(\(item, index\)/, "the AI response index must not become an order");
  assert.doesNotMatch(foodSource, /candidates\s*[:=]\s*\[\.\.\.entry\.candidates\]\.sort/, "AI results must not reorder food candidates");
  assert.doesNotMatch(foodSource, /aiOrdered/);
});

test("the hotel AI writes comparison notes and never reorders or swaps the base", () => {
  for (const [name, source] of [["useHotels", hotelSource], ["usePlanBuild", buildSource]] as const) {
    assert.match(source, /requestHotelRanking\(/, `${name} keeps requesting AI labels`);
    assert.match(source, /notes: Object\.fromEntries\(ai\.ranked\.map\(\(item\) => \[item\.id, \{ reason: item\.reason, tag: item\.tag \}\]\)\)/, `${name} attaches AI notes by candidate id`);
    assert.doesNotMatch(source, /ai\.ranked\.map\(\(item, index\)/, `${name} must not turn the AI order into a rank map`);
    assert.doesNotMatch(source, /ai\.recommendedId/, `${name} must ignore the AI's pick`);
    // No system-sourced selection may run inside the AI response handler.
    assert.doesNotMatch(source, /selectHotelCandidate\([^)]*source:\s*"system"/, `${name} must not auto-swap the base from AI results`);
  }
});

test("client recommendation state carries AI labels only — no AI pick, no AI order", () => {
  assert.doesNotMatch(stateSource, /recommendedId/, "HotelAiState must not store an AI pick");
  assert.doesNotMatch(stateSource, /aiOrdered/, "FoodState must not mark an AI-owned order");
});
