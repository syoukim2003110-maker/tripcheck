"use client";

// The timeline surface (spec v2.1 timeline/): day tabs colored per day with
// weekend and density labels, hosting the active day's DayTimeline as
// children. Product core - the map is auxiliary to this view.
import type { ReactNode } from "react";
import type { BuiltTripPlan } from "../../../../lib/trip-builder";
import { PLANNER_MAP_DAY_COLORS } from "../../../../lib/planner-map-model";
import { weekdayInfo } from "../../../../lib/presentation/trip-presentation";
import { dayTabDensityLabel, dayTabTitle } from "../../../../lib/presentation/timeline-presentation";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy";

type ItineraryTimelineProps = {
  plan: BuiltTripPlan;
  activeDay: number;
  tripDateTouched: boolean;
  locale: PlannerLocale;
  onSwitchDay: (dayIndex: number) => void;
  children: ReactNode;
};

export default function ItineraryTimeline({ plan, activeDay, tripDateTouched, locale, onSwitchDay, children }: ItineraryTimelineProps) {
  return (
    <>
      <div className="planner-day-tabs" role="group" aria-label={locale === "ja" ? "日程を選ぶ" : "Choose a day"}>
        {plan.days.map((candidate, index) => {
          const weekday = tripDateTouched ? weekdayInfo(candidate.date, locale) : null;
          return (
            <button
              aria-current={activeDay === index ? "true" : undefined}
              aria-pressed={activeDay === index}
              className={`is-day-${index % PLANNER_MAP_DAY_COLORS.length + 1}${activeDay === index ? " is-active" : ""}${weekday?.isWeekend ? " is-weekend" : ""}`}
              key={candidate.label}
              onClick={() => onSwitchDay(index)}
              type="button"
            >
              <b>{index + 1}</b>
              <span>
                {dayTabTitle(index, locale)}
                {` · ${dayTabDensityLabel(candidate.stops.length, locale)}`}
              </span>
            </button>
          );
        })}
      </div>
      {children}
    </>
  );
}
