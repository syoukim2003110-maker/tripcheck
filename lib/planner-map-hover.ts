// Timeline → map hover/focus channel (v1.1 spec §7.4, the hover layer of
// two-way sync). Hovering or keyboard-focusing a stop card or a leg row must
// highlight the matching marker/route segment, and pointer movement across
// the timeline must not re-render the planner tree. The shell owns one
// channel instance and hands the same reference to the timeline (writer)
// and the Google map (subscriber); the map applies the highlight through
// its existing imperative marker/polyline seams. Selection stays a separate
// React-state concern and is never written through this channel.

export type PlannerMapHoverTarget =
  | { kind: "stop"; stopId: string }
  | { kind: "leg"; legKey: string };

export type PlannerMapHoverChannel = {
  current: () => PlannerMapHoverTarget | null;
  set: (target: PlannerMapHoverTarget | null) => void;
  subscribe: (listener: (target: PlannerMapHoverTarget | null) => void) => () => void;
};

export function plannerMapHoverTargetsEqual(
  left: PlannerMapHoverTarget | null,
  right: PlannerMapHoverTarget | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.kind === "stop" && right.kind === "stop") return left.stopId === right.stopId;
  if (left.kind === "leg" && right.kind === "leg") return left.legKey === right.legKey;
  return false;
}

export function createPlannerMapHoverChannel(): PlannerMapHoverChannel {
  let current: PlannerMapHoverTarget | null = null;
  const listeners = new Set<(target: PlannerMapHoverTarget | null) => void>();
  return {
    current: () => current,
    set(target) {
      // Equal targets (mouseenter after focus on the same card, repeated
      // moves within one row) must not renotify: every notification touches
      // marker classes and polyline options on the live map.
      if (plannerMapHoverTargetsEqual(current, target)) return;
      current = target;
      for (const listener of [...listeners]) listener(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      // A subscriber that (re)mounts mid-hover must not miss the current target.
      listener(current);
      return () => { listeners.delete(listener); };
    },
  };
}
