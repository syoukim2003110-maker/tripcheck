"use client";

// One day of the itinerary (spec v2.1 timeline/): the day summary (Copy Deck
// plan.day.summary two-number header, time bar, forecast, cautions), the
// tonight-hotel shortcut and the ordered activity/movement list. Renders view
// state and emits events; it never calls an API or edits the plan itself.
// TC-032: the clock range and the planned/available/travel totals live in the
// day-settings disclosure the shell renders below this timeline.
import { Fragment, type ReactNode } from "react";
import Icon from "../../../PlannerIcons";
import PlannerDayTimeBar from "../../../PlannerDayTimeBar";
import { weatherIconByKind } from "../icon-maps";
import EmptyState from "../states/EmptyState";
import ActivityCard from "./ActivityCard";
import MovementCard from "./MovementCard";
import { routeLegKey, type BuiltTripPlan } from "../../../../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../../../../lib/time-feasibility";
import type { TransitLegBoarding } from "../../../../lib/planner-app-state";
import type { RouteStop } from "../../../../lib/route-optimizer";
import type { TripWeatherDay, WeatherKind } from "../../../../lib/weather";
import type { TripHoliday } from "../../../../lib/holidays";
import { poiAccessPolicyForStop } from "../../../../lib/poi-access";
import { buildDayPresentation, dayPresentationFallbackCopy } from "../../../../lib/day-presentation";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";
import {
  dayDateLabel,
  dayHeaderSummary,
  transportModeLabel,
  type DurationEvidenceStatus,
  type TimelineFillerKind,
} from "../../../../lib/presentation/timeline-presentation";

type BuiltPlanDay = BuiltTripPlan["days"][number];
type DayPresentationModel = ReturnType<typeof buildDayPresentation>;
type FitDay = Parameters<typeof PlannerDayTimeBar>[0]["fit"];

type DayTimelineProps = {
  day: BuiltPlanDay;
  locale: PlannerLocale;
  tripDateTouched: boolean;
  weekdayLabel: string | null;
  presentation: DayPresentationModel | null;
  fitDay: FitDay;
  dayTravelTotal: number;
  weather: TripWeatherDay | undefined;
  holiday: TripHoliday | undefined;
  showSundayClosingNote: boolean;
  showTonightHotel: boolean;
  showHotelDepartLeg: boolean;
  showHotelReturnLeg: boolean;
  travelPreference: TravelPreference;
  selectedStopId: string | null;
  durationEvidenceByStopId: Readonly<Record<string, DurationEvidenceStatus>>;
  fillerStopIds: ReadonlySet<string>;
  fillerKindsByStopId: ReadonlyMap<string, Exclude<TimelineFillerKind, undefined>>;
  prefetchTransitSteps: Readonly<Record<string, TransitLegBoarding>>;
  mealRowsAfter?: (stopIndex: number) => ReactNode;
  /** Suggestion rows before the first stop (DoD-PLAN-6: a before-first-anchor gap row). */
  leadingRows?: ReactNode;
  onOpenHotel: () => void;
  onSelectStop: (stopId: string, isSelected: boolean) => void;
  onSetLegMode: (legKey: string, mode: TransportMode) => void;
  onRemoveFiller: (stop: RouteStop) => void;
  /** Hover/focus sync to the map (spec §7.4): null clears the highlight. */
  onHoverStop?: (stopId: string | null) => void;
  onHoverLeg?: (legKey: string | null) => void;
};

export default function DayTimeline({
  day,
  locale,
  tripDateTouched,
  weekdayLabel,
  presentation,
  fitDay,
  dayTravelTotal,
  weather,
  holiday,
  showSundayClosingNote,
  showTonightHotel,
  showHotelDepartLeg,
  showHotelReturnLeg,
  travelPreference,
  selectedStopId,
  durationEvidenceByStopId,
  fillerStopIds,
  fillerKindsByStopId,
  prefetchTransitSteps,
  mealRowsAfter,
  leadingRows,
  onOpenHotel,
  onSelectStop,
  onSetLegMode,
  onRemoveFiller,
  onHoverStop,
  onHoverLeg,
}: DayTimelineProps) {
  const text = ui[locale];
  return (
    <>
      <section className="planner-day-summary">
        <div>
          <span>{dayDateLabel(day, weekdayLabel, tripDateTouched, locale)}</span>
          {presentation?.consistency === "invalid" ? (
            <em className="planner-day-inconsistent" role="alert">
              <b>{dayPresentationFallbackCopy(presentation, locale).title}</b>
              {dayPresentationFallbackCopy(presentation, locale).body}
            </em>
          ) : (
            <>
              <b>{dayHeaderSummary(presentation ?? { stopCount: day.stops.length, slackMinutes: 0 }, locale)}</b>
              <PlannerDayTimeBar day={day} fit={fitDay} locale={locale} />
              {!(fitDay && presentation) && dayTravelTotal > 0
                ? <small className="planner-day-total">{text.travelTotal(dayTravelTotal)}</small>
                : null}
            </>
          )}
          {weather ? (
            <small className="planner-day-forecast">
              <Icon name={weatherIconByKind[weather.kind as WeatherKind] ?? "cloud"} size={12} />
              {weather.temperatureMaxC}° / {weather.temperatureMinC}°
              {weather.precipitationPercent !== null
                ? ` · ${text.precipitation(weather.precipitationPercent)}`
                : ""}
              <em>{text.forecastNote}</em>
            </small>
          ) : null}
          {holiday ? (
            <small className="planner-day-caution">
              {text.holidayNote(holiday.localName)}
              {holiday.nationwide ? "" : text.holidayRegional}
            </small>
          ) : null}
          {showSundayClosingNote ? (
            <small className="planner-day-caution">{text.sundayClosingNote}</small>
          ) : null}
        </div>
      </section>

      {showTonightHotel && day.endBase ? (
        <button className="planner-tonight" onClick={onOpenHotel} type="button">
          <span aria-hidden="true"><Icon name="bed" size={13} /></span>{text.tonightHotel(day.endBase.name)}
        </button>
      ) : null}

      {day.stops.length === 0 ? <EmptyState locale={locale} /> : (
        // DoD-A11Y-5: planner.css sets list-style: none, which makes Safari and
        // VoiceOver drop list semantics — the "item N of M" relationship a
        // screen-reader user needs to follow a day. The explicit role restores
        // it; the label says which day the list belongs to.
        <ol
          aria-label={text.dayTimelineLabel(day.label)}
          className="planner-timeline"
          role="list"
        >
          {leadingRows}
          {day.stops.map((builtStop, index) => {
            const leg = index > 0 ? day.legs[index - 1] : null;
            const recommended = leg?.comparison.recommended;
            const isSelected = selectedStopId === builtStop.stop.id;
            const durationStatus = durationEvidenceByStopId[builtStop.stop.id] ?? "estimated";
            const accessPolicy = poiAccessPolicyForStop(builtStop.stop);
            const isFiller = fillerStopIds.has(builtStop.stop.id);
            const fillerKind = fillerKindsByStopId.get(builtStop.stop.id);
            return (
              <Fragment key={`${builtStop.stop.id}-${index}`}>
              {index === 0 && showHotelDepartLeg && day.hotelOutboundMinutes !== null ? (
                <li className="planner-hotel-leg">
                  <span aria-hidden="true"><Icon name="bed" size={12} /></span>
                  <span>{text.hotelDepartRow(transportModeLabel(day.hotelOutboundMode, travelPreference, locale), day.hotelOutboundMinutes)}</span>
                </li>
              ) : null}
              <li className={isFiller ? `is-system-filler${fillerKind === "lunch" || fillerKind === "dinner" ? " is-meal-filler" : ""}` : undefined}>
                {leg && recommended ? (
                  <MovementCard
                    boarding={prefetchTransitSteps[routeLegKey(leg.from.id, leg.to.id)]}
                    leg={leg}
                    locale={locale}
                    onHoverChange={onHoverLeg ? (legKey, hovered) => onHoverLeg(hovered ? legKey : null) : undefined}
                    onSetLegMode={onSetLegMode}
                    travelPreference={travelPreference}
                  />
                ) : null}
                <ActivityCard
                  accessNote={accessPolicy ? accessPolicy.note[locale] : null}
                  builtStop={builtStop}
                  durationStatus={durationStatus}
                  fillerKind={fillerKind}
                  index={index}
                  isFiller={isFiller}
                  isSelected={isSelected}
                  locale={locale}
                  onHoverChange={onHoverStop ? (stopId, hovered) => onHoverStop(hovered ? stopId : null) : undefined}
                  onRemoveFiller={onRemoveFiller}
                  onSelect={onSelectStop}
                />
              </li>
              {mealRowsAfter?.(index)}
              {index === day.stops.length - 1 && showHotelReturnLeg && day.hotelInboundMinutes !== null ? (
                <li className="planner-hotel-leg is-return">
                  <span aria-hidden="true"><Icon name="bed" size={12} /></span>
                  <span>{text.hotelReturnRow(transportModeLabel(day.hotelInboundMode, travelPreference, locale), day.hotelInboundMinutes)}</span>
                </li>
              ) : null}
              </Fragment>
            );
          })}
        </ol>
      )}
    </>
  );
}
