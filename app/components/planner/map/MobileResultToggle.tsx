"use client";

// The mobile itinerary/map switch. The reference treats this as the primary
// view hierarchy directly below the app bar, so it stays visible while either
// surface (and its stop sheet) is active.
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
