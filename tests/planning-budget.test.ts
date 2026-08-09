import assert from "node:assert/strict";
import test from "node:test";
import { PLANNING_BUDGET, takeWithinPlanningBudget } from "../lib/planning-budget.ts";

test("uses the approved hard ceilings for one trip", () => {
  assert.deepEqual(PLANNING_BUDGET, {
    routeEvents: 20,
    placeResolutions: 12,
    openingHours: 10,
  });
});

test("leaves values beyond a consumed planning budget unrequested", () => {
  const values = Array.from({ length: 15 }, (_, index) => index + 1);
  assert.deepEqual(takeWithinPlanningBudget(values, 10), values.slice(0, 10));
  assert.deepEqual(takeWithinPlanningBudget(values, 10, 8), values.slice(0, 2));
  assert.deepEqual(takeWithinPlanningBudget(values, 10, 10), []);
});
