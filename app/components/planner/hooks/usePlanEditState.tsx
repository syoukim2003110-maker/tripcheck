"use client";

// What the traveller changed about a plan that already exists.
//
// The engine replans from these exactly as it plans from the request, so they
// are domain state, not view state: a locked order, a per-leg transport mode,
// a confirmed last-entry time or a verified opening window all decide what the
// scheduler is allowed to do. Every one of them can create or clear a hard
// constraint, which is why they sit here rather than beside "which day tab is
// selected".
import { useState } from "react";
import type { TransportMode } from "../../../../lib/time-feasibility";
import type { VisitWindow } from "../../../../lib/trip-builder";

export function usePlanEditState() {
  const [legModeOverrides, setLegModeOverrides] = useState<Record<string, TransportMode>>({});
  const [dayOverrides, setDayOverrides] = useState<Record<string, number>>({});
  const [lockedOrderByDay, setLockedOrderByDay] = useState<Record<number, string[]>>({});
  const [mealSelections, setMealSelections] = useState<Record<string, string>>({});
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [userStayMinutes, setUserStayMinutes] = useState<Record<string, number>>({});
  const [lastEntryTimes, setLastEntryTimes] = useState<Record<string, string>>({});
  const [earlyVisitStopIds, setEarlyVisitStopIds] = useState<string[]>([]);
  const [dayStartTimes, setDayStartTimes] = useState<Record<number, string>>({});
  const [dayEndTimes, setDayEndTimes] = useState<Record<number, string>>({});
  const [removedStops, setRemovedStops] = useState<Array<{ id: string; name: string }>>([]);
  const [openingWindowsByDay, setOpeningWindowsByDay] = useState<Record<string, Record<number, VisitWindow[]>>>({});

  return {
    legModeOverrides, setLegModeOverrides,
    dayOverrides, setDayOverrides,
    lockedOrderByDay, setLockedOrderByDay,
    mealSelections, setMealSelections,
    durationOverrides, setDurationOverrides,
    userStayMinutes, setUserStayMinutes,
    lastEntryTimes, setLastEntryTimes,
    earlyVisitStopIds, setEarlyVisitStopIds,
    dayStartTimes, setDayStartTimes,
    dayEndTimes, setDayEndTimes,
    removedStops, setRemovedStops,
    openingWindowsByDay, setOpeningWindowsByDay,
  };
}
