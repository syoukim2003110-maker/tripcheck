import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlannerMapHoverChannel,
  plannerMapHoverTargetsEqual,
  type PlannerMapHoverTarget,
} from "../lib/planner-map-hover.ts";

test("hover-target equality distinguishes stop and leg namespaces", () => {
  const stop: PlannerMapHoverTarget = { kind: "stop", stopId: "a" };
  const leg: PlannerMapHoverTarget = { kind: "leg", legKey: "a" };
  assert.equal(plannerMapHoverTargetsEqual(null, null), true);
  assert.equal(plannerMapHoverTargetsEqual(stop, { kind: "stop", stopId: "a" }), true);
  assert.equal(plannerMapHoverTargetsEqual(leg, { kind: "leg", legKey: "a" }), true);
  // A stop id and a leg key with the same string are different targets.
  assert.equal(plannerMapHoverTargetsEqual(stop, leg), false);
  assert.equal(plannerMapHoverTargetsEqual(stop, null), false);
  assert.equal(plannerMapHoverTargetsEqual(stop, { kind: "stop", stopId: "b" }), false);
});

test("subscribers receive the current target immediately and each change once", () => {
  const channel = createPlannerMapHoverChannel();
  channel.set({ kind: "stop", stopId: "stop-1" });

  const seen: Array<PlannerMapHoverTarget | null> = [];
  const unsubscribe = channel.subscribe((target) => seen.push(target));
  // A subscriber mounting mid-hover must not miss the in-flight target.
  assert.deepEqual(seen, [{ kind: "stop", stopId: "stop-1" }]);

  channel.set({ kind: "leg", legKey: "a::b" });
  channel.set(null);
  assert.deepEqual(seen, [
    { kind: "stop", stopId: "stop-1" },
    { kind: "leg", legKey: "a::b" },
    null,
  ]);
  assert.equal(channel.current(), null);
  unsubscribe();
  channel.set({ kind: "stop", stopId: "stop-2" });
  assert.equal(seen.length, 3);
  assert.deepEqual(channel.current(), { kind: "stop", stopId: "stop-2" });
});

test("setting an equal target never renotifies (map styling is touched per event)", () => {
  const channel = createPlannerMapHoverChannel();
  let notifications = -1; // The immediate subscribe replay is not a change.
  channel.subscribe(() => { notifications += 1; });

  channel.set({ kind: "leg", legKey: "a::b" });
  channel.set({ kind: "leg", legKey: "a::b" });
  assert.equal(notifications, 1);
  channel.set(null);
  channel.set(null);
  assert.equal(notifications, 2);
});
