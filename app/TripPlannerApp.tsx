"use client";

// Thin entry point (refactor spec v2.1 migration map: "TripPlannerApp →
// TripPlannerShell + hooks"). The planner surface — state, hook wiring and
// JSX — lives in TripPlannerShell; this file only preserves the public
// import path and props contract the pages rely on.
import TripPlannerShell from "./components/planner/TripPlannerShell";
import type { PlannerLocale } from "../lib/presentation/planner-copy";

export type TripPlannerAppProps = { initialLocale?: PlannerLocale; mapsApiKey?: string };

export default function TripPlannerApp(props: TripPlannerAppProps) {
  return <TripPlannerShell {...props} />;
}
