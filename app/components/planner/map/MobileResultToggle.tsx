"use client";

// The mobile itinerary/map switch. It is a map control, not a report row, so
// it lives beside the map layer rather than at the top of the result sheet:
// as a sheet row it cost 52px of the first viewport on every screen, and as a
// sticky row it competed with the sticky day rail underneath it. Anchored to
// the bottom of the viewport it stays reachable at any scroll position and
// costs the itinerary nothing.
import type { MobileResultView } from "../../../../lib/planner-app-state.ts";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type MobileResultToggleProps = {
  locale: PlannerLocale;
  view: MobileResultView;
  onChange: (view: MobileResultView) => void;
};

export default function MobileResultToggle({ locale, view, onChange }: MobileResultToggleProps) {
  const options: ReadonlyArray<{ value: MobileResultView; label: string }> = [
    { value: "timeline", label: locale === "ja" ? "旅程" : "Timeline" },
    { value: "map", label: locale === "ja" ? "地図" : "Map" },
  ];
  return (
    <div className="planner-mobile-result-toggle" role="group" aria-label={locale === "ja" ? "結果の表示" : "Result view"}>
      {options.map((option) => (
        <button
          aria-pressed={view === option.value}
          className={view === option.value ? "is-active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >{option.label}</button>
      ))}
    </div>
  );
}
