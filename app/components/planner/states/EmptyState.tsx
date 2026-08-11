"use client";

// Empty-day message (spec v2.1 states/). The day exists; nothing is
// scheduled on it yet.
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";

export default function EmptyState({ locale }: { locale: PlannerLocale }) {
  return <p className="planner-open-day">{ui[locale].openDay}</p>;
}
