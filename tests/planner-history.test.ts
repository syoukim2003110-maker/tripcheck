import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PLANNER_HISTORY,
  canRedoPlannerHistory,
  canUndoPlannerHistory,
  commitPlannerHistory,
  createPlannerHistory,
  redoPlannerHistory,
  undoPlannerHistory,
} from "../lib/planner-history.ts";

type EditState = {
  tripDays: number;
  removedStopIds: string[];
  settings: { start: string; end: string };
};

function state(tripDays: number): EditState {
  return {
    tripDays,
    removedStopIds: [],
    settings: { start: "09:00", end: "22:00" },
  };
}

test("starts with one cloned present state and no Undo or Redo", () => {
  const initial = state(3);
  const history = createPlannerHistory(initial);

  initial.settings.start = "05:00";
  assert.deepEqual(history.present, state(3), "caller mutation must not rewrite the snapshot");
  assert.deepEqual(history.past, []);
  assert.deepEqual(history.future, []);
  assert.equal(canUndoPlannerHistory(history), false);
  assert.equal(canRedoPlannerHistory(history), false);
});

test("commit, Undo and Redo restore complete edit states", () => {
  const initial = createPlannerHistory(state(3));
  const fourDays = commitPlannerHistory(initial, {
    ...state(4),
    removedStopIds: ["optional-cafe"],
  });
  const earlyStart = commitPlannerHistory(fourDays, {
    ...fourDays.present,
    settings: { ...fourDays.present.settings, start: "08:00" },
  });

  assert.equal(earlyStart.past.length, 2);
  assert.equal(earlyStart.future.length, 0);
  assert.equal(canUndoPlannerHistory(earlyStart), true);

  const undoneOnce = undoPlannerHistory(earlyStart);
  assert.deepEqual(undoneOnce.present, fourDays.present);
  assert.equal(canRedoPlannerHistory(undoneOnce), true);

  const undoneTwice = undoPlannerHistory(undoneOnce);
  assert.deepEqual(undoneTwice.present, initial.present);
  assert.strictEqual(undoPlannerHistory(undoneTwice), undoneTwice, "Undo at the boundary is a no-op");

  const redone = redoPlannerHistory(undoneTwice);
  assert.deepEqual(redone.present, fourDays.present);
});

test("a structurally equal commit is a referential no-op", () => {
  const history = createPlannerHistory({
    tripDays: 3,
    settings: { start: "09:00", end: "22:00" },
  });
  const equalWithDifferentKeyOrder = {
    settings: { end: "22:00", start: "09:00" },
    tripDays: 3,
  };

  assert.strictEqual(commitPlannerHistory(history, equalWithDifferentKeyOrder), history);
});

test("a new edit after Undo clears the Redo branch", () => {
  const first = createPlannerHistory(state(2));
  const second = commitPlannerHistory(first, state(3));
  const third = commitPlannerHistory(second, state(4));
  const undone = undoPlannerHistory(third);
  assert.equal(undone.future.length, 1);

  const divergent = commitPlannerHistory(undone, state(5));
  assert.deepEqual(divergent.future, []);
  assert.strictEqual(redoPlannerHistory(divergent), divergent);
});

test("keeps at most 20 previous operations", () => {
  let history = createPlannerHistory(state(0));
  for (let value = 1; value <= 25; value += 1) {
    history = commitPlannerHistory(history, state(value));
  }

  assert.equal(history.past.length, MAX_PLANNER_HISTORY);
  for (let count = 0; count < MAX_PLANNER_HISTORY; count += 1) {
    history = undoPlannerHistory(history);
  }
  assert.equal(history.present.tripDays, 5, "states older than the last 20 operations are discarded");
  assert.strictEqual(undoPlannerHistory(history), history);
});

test("supports a smaller bounded history limit", () => {
  let history = createPlannerHistory(state(1), { limit: 2 });
  history = commitPlannerHistory(history, state(2));
  history = commitPlannerHistory(history, state(3));
  history = commitPlannerHistory(history, state(4));

  assert.equal(history.past.length, 2);
  assert.equal(undoPlannerHistory(undoPlannerHistory(history)).present.tripDays, 2);
  assert.throws(() => createPlannerHistory(state(1), { limit: 21 }), RangeError);
});

test("rejects state that cannot be serialized without losing meaning", () => {
  assert.throws(() => createPlannerHistory({ value: Number.POSITIVE_INFINITY }), /finite/);
  assert.throws(() => createPlannerHistory({ run: () => undefined }), /JSON-serializable/);
  assert.throws(() => createPlannerHistory({ when: new Date() }), /plain objects/);
  assert.throws(() => commitPlannerHistory(createPlannerHistory({}), new Date()), /plain objects/);

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => createPlannerHistory(cyclic), /cycles/);
});
