/**
 * Deterministic history for user-authored planner edits.
 *
 * Keep provider responses, request/loading state, AbortControllers and other
 * asynchronous evidence outside this history. They have their own lifecycle
 * and replaying them would make Undo dependent on network timing. The generic
 * state stored here must therefore be JSON-serializable planner input/edit
 * data only.
 */

export const MAX_PLANNER_HISTORY = 20;

export type PlannerHistory<T> = Readonly<{
  past: readonly T[];
  present: T;
  future: readonly T[];
  limit: number;
}>;

export type PlannerHistoryOptions = Readonly<{
  /** A smaller product-specific limit is allowed; the hard ceiling is 20. */
  limit?: number;
}>;

function normalizedLimit(value: number | undefined) {
  const limit = value ?? MAX_PLANNER_HISTORY;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PLANNER_HISTORY) {
    throw new RangeError(`Planner history limit must be an integer from 1 to ${MAX_PLANNER_HISTORY}.`);
  }
  return limit;
}

function cloneSerializableValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Planner history numbers must be finite.");
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Planner history state must contain JSON-serializable values only.");
  }
  if (ancestors.has(value)) throw new TypeError("Planner history state must not contain cycles.");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Planner history arrays must not be sparse.");
        copy.push(cloneSerializableValue(value[index], ancestors));
      }
      return copy;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Planner history state must use plain objects, not class instances.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Planner history state must not contain symbol keys.");
    }

    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: cloneSerializableValue((value as Record<string, unknown>)[key], ancestors),
        writable: true,
      });
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Clones while rejecting values whose JSON representation would be lossy.
 * This also prevents later mutation of an input object from rewriting history.
 */
export function clonePlannerHistoryState<T>(state: T): T {
  return cloneSerializableValue(state, new Set()) as T;
}

/** Structural equality for the JSON-safe state accepted by this module. */
export function plannerHistoryStateEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => plannerHistoryStateEqual(value, right[index]));
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  const rightObject = right as Record<string, unknown>;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightObject, key)
    && plannerHistoryStateEqual((left as Record<string, unknown>)[key], rightObject[key]));
}

export function createPlannerHistory<T>(initialState: T, options: PlannerHistoryOptions = {}): PlannerHistory<T> {
  return {
    past: [],
    present: clonePlannerHistoryState(initialState),
    future: [],
    limit: normalizedLimit(options.limit),
  };
}

/**
 * Commits one complete user action. A structurally equal state is a true no-op
 * (the same history object is returned), and a divergent edit clears Redo.
 */
export function commitPlannerHistory<T>(history: PlannerHistory<T>, nextState: T): PlannerHistory<T> {
  const next = clonePlannerHistoryState(nextState);
  if (plannerHistoryStateEqual(history.present, next)) return history;
  const past = [...history.past, clonePlannerHistoryState(history.present)].slice(-history.limit);
  return { past, present: next, future: [], limit: history.limit };
}

export function undoPlannerHistory<T>(history: PlannerHistory<T>): PlannerHistory<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: clonePlannerHistoryState(previous),
    future: [clonePlannerHistoryState(history.present), ...history.future],
    limit: history.limit,
  };
}

export function redoPlannerHistory<T>(history: PlannerHistory<T>): PlannerHistory<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, clonePlannerHistoryState(history.present)].slice(-history.limit),
    present: clonePlannerHistoryState(next),
    future: history.future.slice(1),
    limit: history.limit,
  };
}

export function canUndoPlannerHistory<T>(history: PlannerHistory<T>) {
  return history.past.length > 0;
}

export function canRedoPlannerHistory<T>(history: PlannerHistory<T>) {
  return history.future.length > 0;
}
