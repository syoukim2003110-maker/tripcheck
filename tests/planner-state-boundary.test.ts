import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The shell used to declare 53 useState slices in one block, which made the
 * difference between "which panel is open" and "how many days the trip is" a
 * matter of reading fifty lines carefully. They are grouped by who reads them
 * now, and this holds the grouping to its promise: the P2 surface — motion,
 * spacing, responsive behaviour, interaction — lives entirely in the view
 * group, and no field of that group reaches the deterministic engine.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const shell = read("../app/components/planner/TripPlannerShell.tsx");
const requestHook = read("../app/components/planner/hooks/useTripRequestState.tsx");
const editHook = read("../app/components/planner/hooks/usePlanEditState.tsx");
const viewHook = read("../app/components/planner/hooks/usePlannerViewState.tsx");

const declaredIn = (source: string) =>
  [...source.matchAll(/const \[(\w+)(?:, (set\w+))?\] = useState/g)].map((match) => match[1]);

const REQUEST = declaredIn(requestHook);
const EDITS = declaredIn(editHook);
const VIEW = declaredIn(viewHook);

test("the shell declares no state of its own any more", () => {
  assert.equal(
    /\buseState[<(]/.test(shell),
    false,
    "a useState reappeared in the shell; it belongs in one of the three groups",
  );
});

test("the three groups are disjoint and account for every slice", () => {
  const all = [...REQUEST, ...EDITS, ...VIEW];
  assert.equal(new Set(all).size, all.length, "a field is declared in two groups");
  // The pin is the review step: moving a field between groups changes what
  // the boundary below is asserting, so it cannot happen quietly.
  assert.equal(REQUEST.length, 22);
  assert.equal(EDITS.length, 12);
  assert.equal(VIEW.length, 19);
  assert.equal(all.length, 53);
});

test("every group is destructured in the shell, so nothing is silently dropped", () => {
  for (const [name, fields] of [["request", REQUEST], ["edits", EDITS], ["view", VIEW]] as const) {
    for (const field of fields) {
      assert.match(
        shell,
        new RegExp(`\\b${field}\\b`),
        `${name} declares ${field}, which the shell never reads`,
      );
    }
  }
});

test("no view field is an input to the plan", () => {
  // The engine's inputs arrive through the planner context and the build
  // actions. If a view field appeared in either argument object, a change to
  // an animation or a panel could change a schedule.
  const argumentObject = (call: string) => {
    const start = shell.indexOf(call);
    assert.notEqual(start, -1, `${call} is no longer called from the shell`);
    let depth = 0;
    for (let index = start + call.length - 1; index < shell.length; index += 1) {
      if (shell[index] === "{") depth += 1;
      else if (shell[index] === "}") {
        depth -= 1;
        if (depth === 0) return shell.slice(start, index + 1);
      }
    }
    throw new Error(`unbalanced argument object for ${call}`);
  };

  // Three exceptions, all about *whether* work happens rather than what it
  // produces: `activeDay` decides which day's recommendations are fetched,
  // `hasPlan` whether a plan is computed at all, and `planReady` whether a
  // share code is encoded for one. None is an argument to the scheduler —
  // the assertion below holds them to that.
  const allowed = new Set(["activeDay", "hasPlan", "planReady"]);
  for (const call of ["useStablePlannerContext({", "useTripDomainModel({"]) {
    const args = argumentObject(call);
    for (const field of VIEW) {
      if (allowed.has(field)) continue;
      assert.equal(
        new RegExp(`(^|[\\s,{])${field}\\s*[,:}]`, "m").test(args),
        false,
        `${field} is view state but reaches ${call}`,
      );
    }
  }
});

test("the allowed view fields gate the engine, they do not parameterise it", () => {
  const domainModel = read("../app/components/planner/hooks/useTripDomainModel.tsx");
  for (const [, args] of domainModel.matchAll(/\b(?:buildTripFromWishlist|assessTripFit|evaluateTripFeasibility)\(([^)]*)\)/g)) {
    for (const field of ["hasPlan", "planReady", "activeDay", "inspector", "mobileResultView", "printMode"]) {
      assert.equal(
        new RegExp(`(^|[\\s,(])${field}\\s*[,)]`).test(args),
        false,
        `${field} is an argument to the scheduler: ${args.trim().slice(0, 80)}`,
      );
    }
  }
});

test("the engine's own inputs stay where the engine can see them", () => {
  // The mirror of the check above: these are the fields a hard constraint is
  // computed from. If one drifted into the view group it would look safe to
  // change during a design pass, and it is not.
  for (const field of ["tripDays", "tripStartDate", "arrivalTime", "departureTime", "transferBufferMinutes", "pace"]) {
    assert.ok(REQUEST.includes(field), `${field} left the request group`);
  }
  for (const field of ["lockedOrderByDay", "lastEntryTimes", "openingWindowsByDay", "dayStartTimes", "dayEndTimes"]) {
    assert.ok(EDITS.includes(field), `${field} left the plan-edit group`);
  }
});

test("the view hook stays free of engine imports", () => {
  // A view slice typed by the scheduler is a slice the scheduler will end up
  // reading. The one exception is the counterfactual being compared, which is
  // a plan the engine produced and the UI only displays.
  const imports = [...viewHook.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  for (const specifier of imports) {
    assert.equal(
      /trip-builder|time-feasibility|route-optimizer|feasibility-engine/.test(specifier),
      false,
      `the view group imports ${specifier}`,
    );
  }
});
