/*
 * A bundled sight as a place, with the stay the rule by kind gives it
 * (stay.ts) instead of the usual stay from the sight notes. The scenarios
 * the planner's rules were found and pinned on were written with these
 * stays; a test whose subject is a rule of the day (a lunch during a visit,
 * a dinner near the hotel, which place to leave out) keeps its scenario with
 * them, and the notes' stays are tested where they are the subject: the
 * trips of the audit and tests/sight-notes.test.ts.
 */
import type { PopularSight } from "../../lib/popular-sights.ts";
import type { ShioriPlace } from "../../lib/shiori/plan.ts";
import { placeFromSight } from "../../lib/shiori/state.ts";
import { shioriStayMinutes } from "../../lib/shiori/stay.ts";

export function placeByKind(sight: PopularSight, locale: "ja" | "en"): ShioriPlace {
  return { ...placeFromSight(sight, locale), stayMinutes: shioriStayMinutes(sight.kind, `${sight.ja} ${sight.en}`) };
}
