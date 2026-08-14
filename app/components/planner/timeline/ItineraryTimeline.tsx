"use client";

// The timeline surface (spec v2.1 timeline/): day tabs colored per day with
// weekend and density labels, hosting the active day's DayTimeline in the tab
// panel. Product core - the map is auxiliary to this view.
// DoD-A11Y-5 / §12.3: the day switcher is a real WAI-ARIA tablist — roving
// tabindex, ArrowLeft/ArrowRight/Home/End, automatic activation (selection
// follows focus; switching a day is cheap) and a labelled tabpanel, so
// assistive technology can connect each day tab to its stop list.
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { BuiltTripPlan } from "../../../../lib/trip-builder";
import { PLANNER_MAP_DAY_COLORS } from "../../../../lib/planner-map-model";
import { weekdayInfo } from "../../../../lib/presentation/trip-presentation";
import { dayTabDensityLabel, dayTabTitle } from "../../../../lib/presentation/timeline-presentation";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";

type ItineraryTimelineProps = {
  plan: BuiltTripPlan;
  activeDay: number;
  tripDateTouched: boolean;
  locale: PlannerLocale;
  onSwitchDay: (dayIndex: number) => void;
  children: ReactNode;
};

const DAY_PANEL_ID = "planner-day-panel";
const dayTabId = (index: number) => `planner-day-tab-${index + 1}`;

export default function ItineraryTimeline({ plan, activeDay, tripDateTouched, locale, onSwitchDay, children }: ItineraryTimelineProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dayCount = plan.days.length;
  const handleTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (dayCount === 0) return;
    const target: number | undefined = {
      ArrowRight: (activeDay + 1) % dayCount,
      ArrowLeft: (activeDay - 1 + dayCount) % dayCount,
      Home: 0,
      End: dayCount - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    onSwitchDay(target);
    tabRefs.current[target]?.focus();
  };
  return (
    <>
      <div
        aria-label={ui[locale].dayTabsLabel}
        className="planner-day-tabs"
        onKeyDown={handleTablistKeyDown}
        role="tablist"
      >
        {plan.days.map((candidate, index) => {
          const weekday = tripDateTouched ? weekdayInfo(candidate.date, locale) : null;
          const isActive = activeDay === index;
          return (
            <button
              aria-controls={DAY_PANEL_ID}
              aria-selected={isActive}
              className={`is-day-${index % PLANNER_MAP_DAY_COLORS.length + 1}${isActive ? " is-active" : ""}${weekday?.isWeekend ? " is-weekend" : ""}`}
              id={dayTabId(index)}
              key={candidate.label}
              onClick={() => onSwitchDay(index)}
              onFocus={() => { if (!isActive) onSwitchDay(index); }}
              ref={(node) => { tabRefs.current[index] = node; }}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {/* v3.1 §4.2: the rail is day-coloured pills. The numbered badge
                  that used to sit beside the label said the same thing the
                  label says, in a second alphabet; the pill now carries the
                  day's colour itself, which is also what ties it to the map.
                  Density keeps its place on wide screens and steps aside on
                  phones, where a narrow pill means every day of the trip is
                  reachable without scrolling the rail sideways. */}
              <span>{dayTabTitle(index, locale)}</span>
              <i className="planner-day-tab-density">{dayTabDensityLabel(candidate.stops.length, locale)}</i>
            </button>
          );
        })}
      </div>
      {/* v3.1 §5.1: the open day publishes its colour to everything inside it,
          so a stop's marker in the timeline is the same colour as its pin on
          the map. That correspondence is the whole reason the map can stay a
          companion — the numbers and colours already match. */}
      <div
        aria-labelledby={dayTabId(activeDay)}
        className="planner-day-panel"
        id={DAY_PANEL_ID}
        role="tabpanel"
        style={{ "--day-color": PLANNER_MAP_DAY_COLORS[activeDay % PLANNER_MAP_DAY_COLORS.length] } as CSSProperties}
      >
        {children}
      </div>
    </>
  );
}
