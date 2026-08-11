"use client";

// The map-canvas region (spec v2.1 map/): scope toggle, day legend, the
// PlannerGoogleMap invocation, the empty placeholder and the bottom chip row
// (hotel, meals, route ideas, open-in-maps). The inspector asides remain in
// TripPlannerApp and are rendered through `children` so they stay inside the
// planner-map-canvas element exactly as before. Every state change flows up
// through callbacks — the map canvas owns no planner state; the only local
// state is the mobile legend disclosure, which is view-only (TC-040).
import { useState, type CSSProperties, type ReactNode } from "react";
import PlannerGoogleMap, { type PlannerGoogleMapProps } from "../../../PlannerGoogleMap";
import Icon from "../../../PlannerIcons";
import type { BuiltTripPlan, FoodRecommendationSlot } from "../../../../lib/trip-builder.ts";
import type { HotelCandidate } from "../../../../lib/google-hotels.ts";
import type { ItineraryGap } from "../../../../lib/gap-detection.ts";
import type { PlannerMapHoverChannel } from "../../../../lib/planner-map-hover.ts";
import { PLANNER_MAP_DAY_COLORS } from "../../../../lib/planner-map-model.ts";
import {
  P0_CORE_ONLY,
  type FoodState,
  type Inspector,
  type PlannerInputStep,
  type PlannerMapScope,
  type RouteRecommendationState,
  type TransitConvergenceState,
} from "../../../../lib/planner-app-state.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

// Same shared palette constant the timeline uses (v1.1 spec §7.1).
const plannerDayColors = PLANNER_MAP_DAY_COLORS;

type TripMapProps = {
  locale: PlannerLocale;
  hasPlan: boolean;
  isBuilding: boolean;
  inputStep: PlannerInputStep;
  plan: BuiltTripPlan | null;
  day: BuiltTripPlan["days"][number] | null;
  activeDay: number;
  mapScope: PlannerMapScope;
  inspector: Inspector;
  mapsApiKey: string;
  displayedMapStops: PlannerGoogleMapProps["stops"];
  displayedMapBase: PlannerGoogleMapProps["base"];
  dayEndBase: PlannerGoogleMapProps["base"];
  routeDepartureTimes: PlannerGoogleMapProps["departureTimes"];
  activeDestination: PlannerGoogleMapProps["destination"];
  foodPins: PlannerGoogleMapProps["foodPins"];
  hotelPins: PlannerGoogleMapProps["hotelPins"];
  recommendationPins: PlannerGoogleMapProps["recommendationPins"];
  routeBudgetKey: string;
  currentTransitConvergence: TransitConvergenceState | null;
  tripDateTouched: boolean;
  routeTransitGeometry: PlannerGoogleMapProps["transitGeometry"];
  manualPinTarget: number | null;
  manualPinCoordinate: PlannerGoogleMapProps["coordinatePick"];
  mapDayLayers: NonNullable<PlannerGoogleMapProps["dayLayers"]>;
  mapItemKinds: PlannerGoogleMapProps["itemKinds"];
  routeModes: PlannerGoogleMapProps["routeModes"];
  mapWarningStopIds: PlannerGoogleMapProps["warningStopIds"];
  mapFocusedStopId: string | null;
  /** Timeline hover/focus → map highlight channel (spec §7.4); ref-like, never re-renders. */
  mapHoverChannel?: PlannerMapHoverChannel;
  selectedHotel: HotelCandidate | null;
  /** TC-025: the hotel shortlist attaches after the reveal; the slot shows a pending chip until it lands. */
  hotelPending: boolean;
  selectedRouteRecommendationId: string | null;
  daySlots: FoodRecommendationSlot[];
  foodSearches: Record<string, FoodState>;
  primaryRecommendationGap: ItineraryGap | null;
  activeRouteRecommendationState: RouteRecommendationState;
  onChangeMapScope: (scope: PlannerMapScope) => void;
  onSwitchDay: (index: number) => void;
  onRouteGeometry: PlannerGoogleMapProps["onRouteGeometry"];
  onPickCoordinate: NonNullable<PlannerGoogleMapProps["onPickCoordinate"]>;
  onSelectFood: PlannerGoogleMapProps["onSelectFood"];
  onOpenHotelInspector: () => void;
  onToggleHotelInspector: () => void;
  onSelectHotelCandidate: PlannerGoogleMapProps["onSelectHotelCandidate"];
  onSelectRecommendation: PlannerGoogleMapProps["onSelectRecommendation"];
  onSelectDayStop: NonNullable<PlannerGoogleMapProps["onSelectDayStop"]>;
  onSelectStop: PlannerGoogleMapProps["onSelectStop"];
  onOpenFoodSlot: (slot: FoodRecommendationSlot) => void;
  onOpenRouteRecommendations: () => void;
  children?: ReactNode;
};

export default function TripMap({
  locale,
  hasPlan,
  isBuilding,
  inputStep,
  plan,
  day,
  activeDay,
  mapScope,
  inspector,
  mapsApiKey,
  displayedMapStops,
  displayedMapBase,
  dayEndBase,
  routeDepartureTimes,
  activeDestination,
  foodPins,
  hotelPins,
  recommendationPins,
  routeBudgetKey,
  currentTransitConvergence,
  tripDateTouched,
  routeTransitGeometry,
  manualPinTarget,
  manualPinCoordinate,
  mapDayLayers,
  mapItemKinds,
  routeModes,
  mapWarningStopIds,
  mapFocusedStopId,
  mapHoverChannel,
  selectedHotel,
  hotelPending,
  selectedRouteRecommendationId,
  daySlots,
  foodSearches,
  primaryRecommendationGap,
  activeRouteRecommendationState,
  onChangeMapScope,
  onSwitchDay,
  onRouteGeometry,
  onPickCoordinate,
  onSelectFood,
  onOpenHotelInspector,
  onToggleHotelInspector,
  onSelectHotelCandidate,
  onSelectRecommendation,
  onSelectDayStop,
  onSelectStop,
  onOpenFoodSlot,
  onOpenRouteRecommendations,
  children,
}: TripMapProps) {
  const text = ui[locale];
  // TC-040: on phones the legend collapses to a small toggle so it stays
  // reachable without covering the map strip; desktop always shows the body.
  const [legendExpanded, setLegendExpanded] = useState(false);
  return (
    <div className={`planner-map-canvas${displayedMapStops.length > 8 ? " is-dense" : ""}`} role="region" aria-label={text.mapReady}>
      {hasPlan ? (
        <div className="planner-map-scope" role="group" aria-label={locale === "ja" ? "地図に表示する日程" : "Days shown on map"}>
          <button aria-pressed={mapScope === "all"} className={mapScope === "all" ? "is-active" : ""} onClick={() => onChangeMapScope("all")} type="button">{locale === "ja" ? "全日程" : "All days"}</button>
          <button aria-pressed={mapScope === "day"} className={mapScope === "day" ? "is-active" : ""} onClick={() => onChangeMapScope("day")} type="button">{locale === "ja" ? "この日" : "This day"}</button>
        </div>
      ) : null}
      {hasPlan && plan ? (
        // TC-040: the legend renders for 1-day trips too — solid-vs-dashed and
        // anchor-vs-suggestion still need explaining when only one day exists
        // (the day chips then collapse to that single day).
        <div className={`planner-map-day-legend${legendExpanded ? " is-expanded" : ""}`} role="group" aria-label={text.legendLabel}>
          <button
            aria-expanded={legendExpanded}
            className="planner-map-legend-toggle"
            onClick={() => setLegendExpanded((current) => !current)}
            type="button"
          ><span aria-hidden="true"><Icon name="pin" size={12} /></span>{text.legendLabel}</button>
          <div className="planner-map-legend-body">
            {plan.days.map((planDay, index) => (
              <button
                aria-label={locale === "ja" ? `${index + 1}日目を選択` : `Select Day ${index + 1}`}
                aria-pressed={index === activeDay}
                className={index === activeDay ? "is-active" : ""}
                key={planDay.label}
                onClick={() => onSwitchDay(index)}
                style={{ "--planner-day-color": plannerDayColors[index % plannerDayColors.length] } as CSSProperties}
                type="button"
              ><i aria-hidden="true" />{locale === "ja" ? `${index + 1}日` : `D${index + 1}`}</button>
            ))}
            <span className="planner-map-line-legend">
              <i aria-hidden="true" className="is-solid" />{text.legendMeasured}
              <i aria-hidden="true" className="is-dashed" />{text.legendEstimated}
            </span>
            {/* Anchor vs suggestion, mirroring the real marker treatments in
                miniature: filled numbered pin vs dash-outlined star pin. */}
            <span className="planner-map-pin-legend">
              <i aria-hidden="true" className="is-anchor">1</i>{text.legendAnchor}
              <i aria-hidden="true" className="is-suggestion"><Icon name="spark" size={9} /></i>{text.legendSuggestion}
            </span>
          </div>
        </div>
      ) : null}
      {inputStep !== "places" || hasPlan || isBuilding ? <PlannerGoogleMap
        apiKey={mapsApiKey}
        base={displayedMapBase}
        endBase={hasPlan ? dayEndBase : null}
        departureTimes={routeDepartureTimes}
        destination={activeDestination}
        drawRoute={hasPlan}
        foodPins={P0_CORE_ONLY ? [] : foodPins}
        hotelPins={P0_CORE_ONLY ? [] : hotelPins}
        recommendationPins={P0_CORE_ONLY ? [] : recommendationPins}
        routeBudgetKey={routeBudgetKey}
        routeBudgetUsed={currentTransitConvergence?.eventCount ?? 0}
        routeRequestsPaused={!tripDateTouched || Boolean(plan && !currentTransitConvergence)}
        routePauseReason={!tripDateTouched ? "date_required" : plan && !currentTransitConvergence ? "checking" : null}
        transitGeometry={routeTransitGeometry}
        coordinatePickActive={!hasPlan && inputStep === "conditions" && manualPinTarget !== null}
        coordinatePick={manualPinCoordinate}
        inspectorOpen={Boolean(inspector)}
        dayActive
        dayColor={plannerDayColors[activeDay % plannerDayColors.length]}
        dayIndex={activeDay}
        dayLayers={mapScope === "all" ? mapDayLayers : []}
        hoverChannel={mapHoverChannel}
        itemKinds={mapItemKinds}
        locale={locale}
        onRouteGeometry={onRouteGeometry}
        onPickCoordinate={onPickCoordinate}
        onSelectFood={onSelectFood}
        onSelectHotel={selectedHotel ? onOpenHotelInspector : undefined}
        onSelectHotelCandidate={onSelectHotelCandidate}
        onSelectRecommendation={onSelectRecommendation}
        onSelectDayStop={onSelectDayStop}
        onSelectStop={onSelectStop}
        routeModes={routeModes}
        selectedFoodPinId={inspector?.kind === "food" ? inspector.candidateId ?? null : null}
        selectedHotelPinId={selectedHotel?.id ?? null}
        selectedRecommendationPinId={selectedRouteRecommendationId}
        selectedStopId={inspector?.kind === "stop" ? inspector.stopId : inspector?.kind === "hotel" ? displayedMapBase?.id ?? null : mapFocusedStopId}
        stops={displayedMapStops}
        warningStopIds={mapWarningStopIds}
      /> : null}

      {!day && !hasPlan && !isBuilding && displayedMapStops.length === 0 ? <div className="planner-map-empty"><span aria-hidden="true"><Icon name="pin" size={16} /></span><p>{text.mapEmpty}</p></div> : null}

      {day ? (
        <div className="planner-map-bottom">
          {!P0_CORE_ONLY && selectedHotel ? (
            <button
              className={`planner-hotel-chip${inspector?.kind === "hotel" ? " is-active" : ""}`}
              onClick={onToggleHotelInspector}
              type="button"
            >
              <span aria-hidden="true"><Icon name="bed" size={15} /></span>{text.hotelChip}
            </button>
          ) : !P0_CORE_ONLY && hotelPending ? (
            <span className="planner-hotel-chip is-pending" role="status">
              <span aria-hidden="true"><Icon name="bed" size={15} /></span>{text.hotelPending}
            </span>
          ) : null}
          {!P0_CORE_ONLY ? daySlots.map((slot) => {
            const slotState = foodSearches[slot.id];
            return (
              <button
                className={`planner-meal-chip is-${slot.kind}${inspector?.kind === "food" && inspector.slotId === slot.id ? " is-active" : ""}`}
                key={slot.id}
                onClick={() => onOpenFoodSlot(slot)}
                type="button"
              >
                <span aria-hidden="true"><Icon name={slot.kind === "lunch" ? "sun" : "moon"} size={15} /></span>
                {slot.kind === "lunch" ? text.lunchChip : text.dinnerChip}
                {slotState?.status === "ready" && slotState.candidates.length > 0 ? <b>{slotState.candidates.length}</b> : null}
              </button>
            );
          }) : null}
          {!P0_CORE_ONLY && primaryRecommendationGap ? (
            <button
              className={`planner-recommendation-chip${inspector?.kind === "recommendations" ? " is-active" : ""}`}
              onClick={onOpenRouteRecommendations}
              type="button"
            >
              <span aria-hidden="true"><Icon name="spark" size={14} /></span>
              {text.routeIdeasChip}
              {activeRouteRecommendationState.status === "ready" && activeRouteRecommendationState.candidates.length > 0
                ? <b>{activeRouteRecommendationState.candidates.length}</b>
                : null}
            </button>
          ) : null}
          {day.googleMapsUrl ? (
            <a className="planner-open-maps" href={day.googleMapsUrl} rel="noreferrer" target="_blank">
              {text.openMaps}<span aria-hidden="true"><Icon name="external" size={14} /></span>
            </a>
          ) : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}
