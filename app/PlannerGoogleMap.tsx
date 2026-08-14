"use client";

/* Google Maps loads at runtime, so this file keeps the API surface deliberately narrow. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Destination } from "../lib/destinations";
import { decodeGooglePolyline } from "../lib/google-polyline";
import type { RouteStop } from "../lib/route-optimizer";
import type { TransportMode } from "../lib/time-feasibility";
import { PLANNING_BUDGET } from "../lib/planning-budget";
import {
  buildPlannerMapConnectorLine,
  buildPlannerMapDayLayerViews,
  buildPlannerMapLegLineStyles,
  buildPlannerMapPinView,
  buildPlannerMapRouteView,
  plannerRouteGeometryIsDrawable,
  type PlannerMapDayLayer,
  type PlannerMapItemKind,
  type PlannerMapPinView,
} from "../lib/planner-map-model";
import type { PlannerMapHoverChannel, PlannerMapHoverTarget } from "../lib/planner-map-hover";
import { routeLegKey } from "../lib/trip-builder";
import { requestMapRouteGeometry } from "../lib/map-route-geometry-client";

type MapLocale = "en" | "ja";
type RouteState = "idle" | "paused_date" | "loading" | "live" | "partial" | "unavailable";

export type { PlannerMapDayLayer } from "../lib/planner-map-model";

export type FoodPin = {
  id: string;
  candidateId: string;
  slotId: string;
  mealKind: "lunch" | "dinner" | "both";
  name: string;
  latitude: number;
  longitude: number;
  index: number;
};

export type HotelPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  priceLabel: string;
};

export type RecommendationPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  index: number;
};

export type PlannerGoogleMapProps = {
  apiKey: string;
  base: RouteStop | null;
  /** Tonight's hotel when it differs from the morning base (nightly hotel mode). */
  endBase?: RouteStop | null;
  departureTimes: string[];
  drawRoute?: boolean;
  foodPins: FoodPin[];
  hotelPins: HotelPin[];
  recommendationPins: RecommendationPin[];
  /** Stable for one result. Changing it starts a fresh trip-scoped API budget. */
  routeBudgetKey: string;
  /** Provider events already consumed by the transit convergence loop. */
  routeBudgetUsed: number;
  /** Holds display-only walking/taxi fetches until transit convergence ends. */
  routeRequestsPaused: boolean;
  /** Explains a deliberate pause without presenting it as provider failure. */
  routePauseReason?: "date_required" | "checking" | null;
  /** Already-fetched transit geometry, aligned to the visible physical legs. */
  transitGeometry: readonly (readonly { latitude: number; longitude: number }[] | null)[];
  /** Lets one unresolved occurrence be positioned without rebuilding the trip. */
  coordinatePickActive?: boolean;
  coordinatePick?: { latitude: number; longitude: number } | null;
  inspectorOpen: boolean;
  /** Zero-based day index shared with the timeline. */
  dayIndex?: number;
  /** Optional shared timeline/map colour. Falls back to the map day palette. */
  dayColor?: string;
  /** In all-days views, non-selected routes use the 2px/faint treatment. */
  dayActive?: boolean;
  /**
   * Optional all-days snapshot. The current day remains authoritative through
   * the legacy route props; provider-backed inactive layers are display-only.
   */
  dayLayers?: readonly PlannerMapDayLayer[];
  /** Item semantics keyed by the same stable id used by timeline selection. */
  itemKinds?: Readonly<Record<string, PlannerMapItemKind>>;
  /** Consequential stop warnings are marked with an explicit `!`, not colour alone. */
  warningStopIds?: readonly string[];
  /**
   * Timeline hover/focus → map highlight channel (spec §7.4). Ref-like on
   * purpose: writes never re-render this component; the subscription applies
   * the highlight through the imperative marker/polyline seams.
   */
  hoverChannel?: PlannerMapHoverChannel | null;
  destination: Destination;
  locale: MapLocale;
  onRouteGeometry: (points: Array<{ latitude: number; longitude: number }>) => void;
  onPickCoordinate?: (point: { latitude: number; longitude: number }) => void;
  onSelectFood: (slotId: string, candidateId: string) => void;
  onSelectHotel?: () => void;
  onSelectHotelCandidate: (candidateId: string) => void;
  onSelectRecommendation: (candidateId: string) => void;
  onSelectStop: (stopId: string | null) => void;
  /** Lets an inactive marker activate its day before opening the shared item. */
  onSelectDayStop?: (dayIndex: number, stopId: string) => void;
  routeModes: TransportMode[];
  selectedFoodPinId: string | null;
  selectedHotelPinId: string | null;
  selectedRecommendationPinId: string | null;
  selectedStopId: string | null;
  stops: RouteStop[];
};

const EMPTY_DAY_LAYERS: readonly PlannerMapDayLayer[] = [];

declare global {
  interface Window {
    google?: any;
    __tripcheckMapsPromise?: Promise<any>;
    __tripcheckMapsReady?: () => void;
    __tripcheckMapsAuthFailed?: boolean;
    gm_authFailure?: () => void;
  }
}

const MAPS_AUTH_FAILURE_EVENT = "tripcheck:maps-auth-failure";

function installGoogleMapsAuthFailureBridge() {
  const current = window.gm_authFailure as ((() => void) & { __tripcheckBridge?: boolean }) | undefined;
  if (current?.__tripcheckBridge) return;
  const bridge = (() => {
    window.__tripcheckMapsAuthFailed = true;
    window.__tripcheckMapsPromise = undefined;
    window.dispatchEvent(new Event(MAPS_AUTH_FAILURE_EVENT));
  }) as (() => void) & { __tripcheckBridge?: boolean };
  bridge.__tripcheckBridge = true;
  window.gm_authFailure = bridge;
}
/* Neutral, decluttered basemap (ride-hail style) so pins and the route stay the loudest layer. */
const warmMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f4f4f5" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#75757e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#e3e3e8" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e0ecdf" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#ececf0" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f1f1f4" }] },
  { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#dcdce2" }] },
  { featureType: "transit.station", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cdddea" }] },
];

async function loadGoogleMaps(apiKey: string) {
  installGoogleMapsAuthFailureBridge();
  if (window.__tripcheckMapsAuthFailed) throw new Error("maps_auth_failure");
  if (window.google?.maps?.importLibrary) return window.google;
  if (!apiKey) throw new Error("maps_not_configured");
  if (!window.__tripcheckMapsPromise) {
    window.__tripcheckMapsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      window.__tripcheckMapsAuthFailed = false;
      window.__tripcheckMapsReady = () => {
        delete window.__tripcheckMapsReady;
        resolve(window.google);
      };
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=__tripcheckMapsReady`;
      script.onerror = () => {
        delete window.__tripcheckMapsReady;
        window.__tripcheckMapsPromise = undefined;
        reject(new Error("maps_unavailable"));
      };
      document.head.append(script);
    });
  }
  return window.__tripcheckMapsPromise;
}

function usableDepartureTime(value: string) {
  const date = new Date(value);
  const deltaDays = (date.getTime() - Date.now()) / 86_400_000;
  return Number.isFinite(deltaDays) && deltaDays >= -7 && deltaDays <= 100 ? date : undefined;
}

type MapPadding = { top: number; right: number; bottom: number; left: number };

// TC-039: every fitted point must stay ≥40px clear of the canvas edges.
// Top and bottom already exceed that (topbar / bottom chip clearance); the
// sides are held at 40px on desktop and mobile alike. The open inspector
// still widens the desktop right padding beyond the minimum.
function visibleMapPadding(map: any, inspectorOpen: boolean): MapPadding {
  const container = map.getDiv() as HTMLElement;
  const width = Math.max(320, container.clientWidth);
  const height = Math.max(320, container.clientHeight);
  const mobile = window.matchMedia("(max-width: 840px)").matches;
  if (mobile) {
    const top = 74;
    const preferredBottom = Math.round(height * (inspectorOpen ? 0.64 : 0.54));
    return { top, right: 40, bottom: Math.min(preferredBottom, Math.max(100, height - top - 140)), left: 40 };
  }
  const left = 40;
  const right = inspectorOpen ? Math.min(408, Math.max(40, width - left - 160)) : 40;
  return { top: 92, right, bottom: 72, left };
}

function roughGapMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}

/*
 * Measured provider geometry can legitimately stop short of the itinerary
 * POI: mountain summits route to their access station (Eigergletscher for
 * Jungfraujoch), so the solid line would end mid-mountain and the route
 * looks broken. Bridge such gaps with the dashed connector so the sequence
 * stays visually continuous without presenting the missing climb as a road.
 */
function accessBridgeSegments(
  path: Array<{ lat: number; lng: number }>,
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  if (path.length < 2) return [];
  const segments: Array<Array<{ lat: number; lng: number }>> = [];
  const head = path[0];
  const tail = path[path.length - 1];
  const fromPoint = { lat: from.latitude, lng: from.longitude };
  const toPoint = { lat: to.latitude, lng: to.longitude };
  if (roughGapMeters(head, fromPoint) > 300) segments.push([fromPoint, head]);
  if (roughGapMeters(tail, toPoint) > 300) segments.push([tail, toPoint]);
  return segments;
}

function fitVisibleBounds(map: any, bounds: any, inspectorOpen: boolean) {
  map.fitBounds(bounds, visibleMapPadding(map, inspectorOpen));
  // A day whose stops are metres apart (hotel + the town it sits in) would
  // otherwise fit at zoom ~21: a featureless grey close-up. Only such
  // degenerate fits register the clamp, so a deliberate later deep zoom is
  // never snapped back by a stale one-shot listener.
  const span = bounds?.toSpan?.();
  const degenerate = span && Math.max(span.lat?.() ?? 0, span.lng?.() ?? 0) < 0.006;
  if (!degenerate) return;
  const clampZoom = () => {
    const zoom = map.getZoom?.();
    if (typeof zoom === "number" && zoom > 16) map.setZoom(16);
  };
  const maps = (globalThis as { google?: { maps?: { event?: { addListenerOnce?: (target: unknown, eventName: string, handler: () => void) => { remove?: () => void } } } } }).google?.maps;
  if (maps?.event?.addListenerOnce) {
    // fitBounds that changes nothing fires no "idle"; an armed one-shot from
    // such a fit would snap the user's next manual deep zoom. Keep at most
    // one armed clamp per map and disarm the previous one first.
    (map.__tripcheckZoomClamp as { remove?: () => void } | undefined)?.remove?.();
    map.__tripcheckZoomClamp = maps.event.addListenerOnce(map, "idle", () => {
      map.__tripcheckZoomClamp = null;
      clampZoom();
    });
  } else clampZoom();
}

function focusVisiblePoint(map: any, position: { lat: number; lng: number }, inspectorOpen: boolean) {
  const padding = visibleMapPadding(map, inspectorOpen);
  map.panTo(position);
  map.panBy((padding.right - padding.left) / 2, (padding.bottom - padding.top) / 2);
}

type Chip = {
  overlay: any;
  stopId: string;
  setSelected: (selected: boolean) => void;
  /** Timeline-driven hover/focus highlight (spec §7.4); class-only, no rebuild. */
  setTimelineHover: (hovered: boolean) => void;
};

/* Same glyphs as the in-app icon set, inlined because chips are plain DOM. */
const HOTEL_BADGE_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5v12"/><path d="M3 15h18"/><path d="M21 18.5v-5a3.5 3.5 0 0 0-3.5-3.5H10v5"/><rect x="5" y="10.9" width="4" height="2.6" rx="1.3"/></svg>`;
const MEAL_BADGE_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5v4.6a2.4 2.4 0 0 0 4.8 0V3.5"/><path d="M9.4 10.5V20.5"/><path d="M16.2 3.5c1.9 1.9 2.7 4.4 2.7 6.8 0 2.3-1.1 3.7-2.7 4.2v6"/></svg>`;
const LUNCH_BADGE_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg>`;
const DINNER_BADGE_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 15.1A8.3 8.3 0 0 1 8.9 4a8.4 8.4 0 1 0 11.1 11.1Z"/></svg>`;
const RECOMMENDATION_BADGE_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 13.7 10.3 20.5 12 13.7 13.7 12 20.5 10.3 13.7 3.5 12 10.3 10.3Z"/></svg>`;

function createChip(
  google: any,
  map: any,
  options: {
    position: { lat: number; lng: number };
    name: string;
    view: PlannerMapPinView;
    pixelOffsetX?: number;
    stopId: string;
    dayAppearance?: {
      dayIndex: number;
      dayNumber: number;
      color: string;
      active: boolean;
      pinOpacity: number;
      pinZIndex: number;
    };
    onClick?: () => void;
  },
): Chip {
  const overlay = new google.maps.OverlayView();
  let element: HTMLButtonElement | null = null;
  let label: HTMLSpanElement | null = null;
  let selected = false;
  let hovered = false;
  let focused = false;
  let timelineHovered = false;
  const syncInteractionState = () => {
    if (!element || !label) return;
    const visible = selected || hovered || focused || timelineHovered;
    label.hidden = !visible;
    element.classList.toggle("is-label-visible", visible);
    if (options.dayAppearance) {
      element.style.opacity = String(selected || timelineHovered ? 1 : options.dayAppearance.pinOpacity);
      element.style.zIndex = String(selected ? 6 : timelineHovered ? 5 : options.dayAppearance.pinZIndex);
    }
  };
  overlay.onAdd = function onAdd() {
    element = document.createElement("button");
    element.type = "button";
    element.className = options.view.className;
    // A hover set before the overlay's async onAdd must not be lost.
    if (timelineHovered) element.classList.add("is-timeline-hover");
    element.dataset.itemId = options.stopId;
    element.dataset.itemKind = options.view.kind;
    element.dataset.markerShape = options.view.shape;
    element.dataset.labelVisibility = options.view.labelVisibility;
    if (options.dayAppearance) {
      const appearance = options.dayAppearance;
      element.classList.add(`is-day-${appearance.dayNumber}`, appearance.active ? "is-active-day" : "is-inactive-day");
      element.dataset.dayColor = appearance.color;
      element.dataset.dayIndex = String(appearance.dayIndex);
      element.style.setProperty("--planner-map-day-color", appearance.color);
      element.style.opacity = String(appearance.pinOpacity);
      element.style.zIndex = String(appearance.pinZIndex);
    }
    const badge = document.createElement("i");
    if (options.view.glyph === "bed") badge.innerHTML = HOTEL_BADGE_SVG;
    else if (options.view.glyph === "meal") badge.innerHTML = MEAL_BADGE_SVG;
    else if (options.view.glyph === "lunch") badge.innerHTML = LUNCH_BADGE_SVG;
    else if (options.view.glyph === "dinner") badge.innerHTML = DINNER_BADGE_SVG;
    else if (options.view.glyph === "star") badge.innerHTML = RECOMMENDATION_BADGE_SVG;
    else badge.textContent = options.view.badge;
    if (options.dayAppearance) {
      const { color } = options.dayAppearance;
      element.style.borderColor = color;
      if (options.view.kind === "anchor") {
        badge.style.backgroundColor = color;
      } else if (options.view.kind === "filler") {
        badge.style.backgroundColor = "#ffffff";
        badge.style.border = `2px solid ${color}`;
        badge.style.color = color;
      }
    }
    label = document.createElement("span");
    label.textContent = options.name;
    label.hidden = true;
    element.append(badge, label);
    if (options.view.warningBadge) {
      const warning = document.createElement("b");
      warning.className = "planner-map-chip-warning";
      warning.textContent = options.view.warningBadge;
      warning.setAttribute("aria-hidden", "true");
      element.append(warning);
    }
    element.title = options.name;
    element.setAttribute("aria-label", `${options.name}, ${options.view.ariaKind}`);
    element.addEventListener("mouseenter", () => {
      hovered = true;
      syncInteractionState();
    });
    element.addEventListener("mouseleave", () => {
      hovered = false;
      syncInteractionState();
    });
    element.addEventListener("focus", () => {
      focused = true;
      syncInteractionState();
    });
    element.addEventListener("blur", () => {
      focused = false;
      syncInteractionState();
    });
    if (options.onClick) {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onClick?.();
      });
    } else {
      element.disabled = true;
      element.tabIndex = -1;
      element.setAttribute("aria-hidden", "true");
    }
    // Google Maps also dispatches its own synthetic map click after a DOM
    // overlay click. DOM stopPropagation alone does not reliably stop that
    // second event, which immediately cleared the selected stop again.
    google.maps.OverlayView.preventMapHitsAndGesturesFrom?.(element);
    this.getPanes()?.overlayMouseTarget.appendChild(element);
  };
  overlay.draw = function draw() {
    if (!element) return;
    const projection = this.getProjection();
    if (!projection) return;
    const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(options.position));
    if (!point) return;
    element.style.left = `${point.x + (options.pixelOffsetX ?? 0)}px`;
    element.style.top = `${point.y}px`;
  };
  overlay.onRemove = function onRemove() {
    element?.remove();
    element = null;
  };
  overlay.setMap(map);
  return {
    overlay,
    stopId: options.stopId,
    setSelected: (nextSelected: boolean) => {
      selected = nextSelected;
      element?.classList.toggle("is-selected", selected);
      syncInteractionState();
    },
    setTimelineHover: (nextHovered: boolean) => {
      if (timelineHovered === nextHovered) return;
      timelineHovered = nextHovered;
      element?.classList.toggle("is-timeline-hover", timelineHovered);
      syncInteractionState();
    },
  };
}

export default function PlannerGoogleMap({
  apiKey,
  base,
  endBase = null,
  departureTimes,
  destination,
  drawRoute = true,
  foodPins,
  hotelPins,
  recommendationPins,
  routeBudgetKey,
  routeBudgetUsed,
  routeRequestsPaused,
  routePauseReason = null,
  transitGeometry,
  coordinatePickActive = false,
  coordinatePick = null,
  inspectorOpen,
  dayIndex = 0,
  dayColor,
  dayActive = true,
  dayLayers = EMPTY_DAY_LAYERS,
  itemKinds = {},
  warningStopIds = [],
  hoverChannel = null,
  locale,
  onRouteGeometry,
  onPickCoordinate,
  onSelectFood,
  onSelectHotel,
  onSelectHotelCandidate,
  onSelectRecommendation,
  onSelectStop,
  onSelectDayStop,
  routeModes,
  selectedFoodPinId,
  selectedHotelPinId,
  selectedRecommendationPinId,
  selectedStopId,
  stops,
}: PlannerGoogleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The opening view is fixed at mount; once a country or a stop set exists,
  // the recentre effect below owns where the map looks.
  const openingViewRef = useRef(destination);
  const engineRef = useRef<{ google: any; map: any; maps: any } | null>(null);
  const chipsRef = useRef<Chip[]>([]);
  const routeLinesRef = useRef<any[]>([]);
  // Registered leg lines keyed by the shared timeline leg key so a hovered
  // MovementCard can restyle exactly its own segment (measured stroke +
  // outline, or the dashed connector when nothing was measured).
  const legLinesRef = useRef<Array<{ legKey: string; line: any; base: object; highlight: object; highlighted: boolean }>>([]);
  const hoverTargetRef = useRef<PlannerMapHoverTarget | null>(null);
  const dayLayerChipsRef = useRef<Chip[]>([]);
  const dayLayerLinesRef = useRef<any[]>([]);
  const foodChipsRef = useRef<Chip[]>([]);
  const hotelChipsRef = useRef<Chip[]>([]);
  const recommendationChipsRef = useRef<Chip[]>([]);
  const coordinatePickChipRef = useRef<Chip | null>(null);
  const suppressMapClickUntilRef = useRef(0);
  const legCacheRef = useRef<Map<string, { path: any[]; minutes: number | null; fetchedAt: string | null }>>(new Map());
  const routeBudgetRef = useRef({ key: routeBudgetKey, used: routeBudgetUsed });
  const renderSeqRef = useRef(0);
  const routeGeometryAbortRef = useRef<AbortController | null>(null);
  const departureTimesRef = useRef(departureTimes);
  const inspectorOpenRef = useRef(inspectorOpen);
  const onSelectFoodRef = useRef(onSelectFood);
  const onSelectHotelRef = useRef(onSelectHotel);
  const onSelectHotelCandidateRef = useRef(onSelectHotelCandidate);
  const onSelectRecommendationRef = useRef(onSelectRecommendation);
  const onSelectStopRef = useRef(onSelectStop);
  const onSelectDayStopRef = useRef(onSelectDayStop);
  const selectedStopIdRef = useRef(selectedStopId);
  const onRouteGeometryRef = useRef(onRouteGeometry);
  const onPickCoordinateRef = useRef(onPickCoordinate);
  const coordinatePickActiveRef = useRef(coordinatePickActive);
  const [engineState, setEngineState] = useState<"loading" | "js" | "unavailable">(apiKey ? "loading" : "unavailable");
  // "auth" is a rejected key and retrying only fails again; "load" (script
  // error or tiles that never arrived) is usually a slow or dropped network,
  // so that case keeps an explicit way back instead of losing the map for
  // the rest of the session.
  const [unavailableReason, setUnavailableReason] = useState<"auth" | "load" | "not_configured">(apiKey ? "load" : "not_configured");
  const [mapBootAttempt, setMapBootAttempt] = useState(0);
  const [routeState, setRouteState] = useState<RouteState>("idle");

  useEffect(() => {
    if (routeBudgetRef.current.key !== routeBudgetKey) {
      routeBudgetRef.current = { key: routeBudgetKey, used: routeBudgetUsed };
      legCacheRef.current.clear();
      return;
    }
    routeBudgetRef.current.used = Math.max(routeBudgetRef.current.used, routeBudgetUsed);
  }, [routeBudgetKey, routeBudgetUsed]);

  useEffect(() => {
    departureTimesRef.current = departureTimes;
    inspectorOpenRef.current = inspectorOpen;
    onSelectFoodRef.current = onSelectFood;
    onSelectHotelRef.current = onSelectHotel;
    onSelectHotelCandidateRef.current = onSelectHotelCandidate;
    onSelectRecommendationRef.current = onSelectRecommendation;
    onSelectStopRef.current = onSelectStop;
    onSelectDayStopRef.current = onSelectDayStop;
    selectedStopIdRef.current = selectedStopId;
    onRouteGeometryRef.current = onRouteGeometry;
    onPickCoordinateRef.current = onPickCoordinate;
    coordinatePickActiveRef.current = coordinatePickActive;
  });

  // Applies the timeline-driven hover/focus highlight (spec §7.4) through the
  // existing imperative seams: a CSS class on the marker chip and setOptions
  // on already-built polylines. No overlay is ever rebuilt for hover. The
  // mirrored data attributes make the state observable to the QA harness even
  // when the JS map cannot load.
  const applyTimelineHover = useCallback(() => {
    const target = hoverTargetRef.current;
    const hoveredStopId = target?.kind === "stop" ? target.stopId : null;
    const hoveredLegKey = target?.kind === "leg" ? target.legKey : null;
    chipsRef.current.forEach((chip) => chip.setTimelineHover(chip.stopId === hoveredStopId));
    dayLayerChipsRef.current.forEach((chip) => chip.setTimelineHover(chip.stopId === hoveredStopId));
    for (const entry of legLinesRef.current) {
      const highlighted = entry.legKey === hoveredLegKey;
      if (entry.highlighted === highlighted) continue;
      entry.highlighted = highlighted;
      entry.line.setOptions(highlighted ? entry.highlight : entry.base);
    }
    const container = containerRef.current;
    if (!container) return;
    if (hoveredStopId) container.dataset.timelineHoverStop = hoveredStopId;
    else delete container.dataset.timelineHoverStop;
    if (hoveredLegKey) container.dataset.timelineHoverLeg = hoveredLegKey;
    else delete container.dataset.timelineHoverLeg;
  }, []);

  useEffect(() => {
    if (!hoverChannel) return;
    return hoverChannel.subscribe((target) => {
      hoverTargetRef.current = target;
      applyTimelineHover();
    });
  }, [applyTimelineHover, hoverChannel]);

  const finishBase = base && endBase && endBase.id !== base.id ? endBase : null;
  const displayStops = base ? [base, ...stops, ...(finishBase ? [finishBase] : [])] : stops;
  const pathStops = base && stops.length > 0 ? [base, ...stops, finishBase ?? base] : stops;
  const routeView = buildPlannerMapRouteView({ dayIndex, dayColor, active: dayActive });
  const activeDayAppearance = {
    dayIndex: routeView.dayIndex,
    dayNumber: routeView.dayNumber,
    color: routeView.color,
    active: dayActive,
    pinOpacity: dayActive ? 1 : 0.38,
    pinZIndex: dayActive ? 3 : 0,
  };
  const dayLayerViews = buildPlannerMapDayLayerViews(dayLayers, { activeDayIndex: dayIndex, locale });
  const warningStopIdSet = new Set(warningStopIds);
  const stopsSignature = `${destination.id}:${destination.regionCode ?? "worldwide"}|${locale}|${onSelectHotel ? "hotel-on" : "hotel-off"}|${displayStops.map((stop) => `${stop.id}@${stop.name}@${stop.latitude.toFixed(5)},${stop.longitude.toFixed(5)}:${itemKinds[stop.id] ?? "anchor"}:${warningStopIdSet.has(stop.id) ? "warning" : "clear"}`).join("|")}`;
  const transitGeometrySignature = transitGeometry.map((points) => points
    ? points.map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`).join(";")
    : "-").join("|");
  const routeSignature = `${routeBudgetKey}|${stopsSignature}|${drawRoute ? "route" : "pins"}|${routeRequestsPaused ? `paused:${routePauseReason ?? "checking"}` : "ready"}|${routeModes.join(",")}|${departureTimes.join(",")}|${transitGeometrySignature}|${routeView.dayIndex}:${routeView.color}:${dayActive ? "active" : "inactive"}`;
  const pinDaySignature = `${locale}:${routeView.dayIndex}:${routeView.color}:${dayActive ? "active" : "inactive"}`;
  const foodSignature = `${pinDaySignature}|${foodPins.map((pin) => `${pin.id}:${pin.mealKind}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}`).join("|")}`;
  const hotelSignature = `${pinDaySignature}|${hotelPins.map((pin) => `${pin.id}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}:${pin.priceLabel}`).join("|")}`;
  const recommendationSignature = `${pinDaySignature}|${recommendationPins.map((pin) => `${pin.id}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}`).join("|")}`;
  const coordinatePickSignature = coordinatePick
    ? `${coordinatePick.latitude.toFixed(6)},${coordinatePick.longitude.toFixed(6)}`
    : "none";
  const dayLayersSignature = dayLayerViews.map((layer) => [
    `${layer.dayIndex}:${layer.color}:${layer.active ? "active" : "inactive"}`,
    layer.stops.map((stop) => `${stop.id}:${stop.sequence}@${stop.latitude.toFixed(5)},${stop.longitude.toFixed(5)}:${stop.pin.kind}:${stop.warning ? "warning" : "clear"}`).join(","),
    layer.drawableSegments.map((segment) => segment.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(";")).join("/"),
  ].join("|")).join("||");

  useEffect(() => {
    let cancelled = false;
    let authFailed = false;
    let tilesListener: any = null;
    let clickListener: any = null;
    let tilesTimeout: number | null = null;
    const markUnavailable = (reason: "auth" | "load") => {
      authFailed = true;
      if (tilesTimeout !== null) window.clearTimeout(tilesTimeout);
      if (cancelled) return;
      setUnavailableReason(apiKey ? reason : "not_configured");
      setEngineState("unavailable");
    };
    const onAuthFailure = () => markUnavailable("auth");
    window.addEventListener(MAPS_AUTH_FAILURE_EVENT, onAuthFailure);
    async function boot() {
      if (!containerRef.current) return;
      if (!apiKey) {
        markUnavailable("load");
        return;
      }
      try {
        const google = await loadGoogleMaps(apiKey);
        const [{ Map }, core] = await Promise.all([
          google.maps.importLibrary("maps"),
          google.maps.importLibrary("core"),
        ]);
        if (cancelled || authFailed || !containerRef.current) return;
        // Read through a ref: the opening view only matters at creation, and
        // rebuilding the whole map when the country changes would throw away
        // every overlay for nothing.
        const opening = openingViewRef.current;
        const map = new Map(containerRef.current, {
          center: { lat: opening.center.latitude, lng: opening.center.longitude },
          zoom: opening.overviewZoom,
          clickableIcons: false,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
          // UI/UX v3.1 §6.5 / reference 02: a scale bar. A route drawn without
          // one leaves "is this a walk or an hour on a train" to the eye, and
          // the eye is wrong at every zoom the traveller changes to.
          scaleControl: true,
          styles: warmMapStyle,
          backgroundColor: "#f4f4f5",
        });
        clickListener = map.addListener("click", (event: any) => {
          if (Date.now() < suppressMapClickUntilRef.current) return;
          const clickedElement = event?.domEvent?.target;
          if (clickedElement instanceof Element && clickedElement.closest(".planner-map-chip")) return;
          onSelectStopRef.current(null);
          if (!coordinatePickActiveRef.current) return;
          const latitude = event?.latLng?.lat?.();
          const longitude = event?.latLng?.lng?.();
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
          onPickCoordinateRef.current?.({ latitude, longitude });
        });
        engineRef.current = { google, map, maps: { core } };
        tilesListener = google.maps.event.addListenerOnce(map, "tilesloaded", () => {
          if (tilesTimeout !== null) window.clearTimeout(tilesTimeout);
          if (!cancelled && !authFailed) setEngineState("js");
        });
        tilesTimeout = window.setTimeout(() => markUnavailable("load"), 12_000);
      } catch (error) {
        markUnavailable((error as Error)?.message === "maps_auth_failure" ? "auth" : "load");
      }
    }
    void boot();
    return () => {
      cancelled = true;
      window.removeEventListener(MAPS_AUTH_FAILURE_EVENT, onAuthFailure);
      if (tilesTimeout !== null) window.clearTimeout(tilesTimeout);
      chipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      dayLayerChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      foodChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      hotelChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      recommendationChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      coordinatePickChipRef.current?.overlay.setMap(null);
      coordinatePickChipRef.current = null;
      routeLinesRef.current.forEach((line) => line.setMap(null));
      dayLayerLinesRef.current.forEach((line) => line.setMap(null));
      if (tilesListener) tilesListener.remove();
      if (clickListener) clickListener.remove();
      engineRef.current = null;
    };
  }, [apiKey, mapBootAttempt]);

  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const seq = ++renderSeqRef.current;
    const { google, map } = engineRef.current;
    const { LatLngBounds } = engineRef.current.maps.core;

    chipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    chipsRef.current = [];
    routeLinesRef.current.forEach((line) => line.setMap(null));
    routeLinesRef.current = [];
    legLinesRef.current = [];

    const legLineStyles = buildPlannerMapLegLineStyles(routeView);
    const registerLegLine = (legKey: string, role: "outline" | "stroke" | "connector", line: any) => {
      legLinesRef.current.push({
        legKey,
        line,
        base: legLineStyles.base[role],
        highlight: legLineStyles.highlight[role],
        highlighted: false,
      });
    };

    chipsRef.current = displayStops.map((stop, index) => {
      const isHotel = Boolean(base) && (index === 0 || (Boolean(finishBase) && index === displayStops.length - 1));
      const sequence = base ? index : index + 1;
      const view = buildPlannerMapPinView({
        kind: isHotel ? "hotel" : itemKinds[stop.id] ?? "anchor",
        sequence,
        warning: warningStopIdSet.has(stop.id),
        locale,
      });
      const chip = createChip(google, map, {
        position: { lat: stop.latitude, lng: stop.longitude },
        name: stop.name,
        pixelOffsetX: isHotel ? 0 : (sequence % 2 === 0 ? -10 : 10),
        view,
        stopId: stop.id,
        dayAppearance: activeDayAppearance,
        onClick: isHotel
          ? (onSelectHotelRef.current ? () => { suppressMapClickUntilRef.current = Date.now() + 250; onSelectHotelRef.current?.(); } : undefined)
          : () => { suppressMapClickUntilRef.current = Date.now() + 250; onSelectStopRef.current(stop.id); },
      });
      chip.setSelected(chip.stopId === selectedStopIdRef.current);
      return chip;
    });
    // Fresh chips must pick up an in-flight timeline hover immediately.
    applyTimelineHover();

    if (displayStops.length === 0) {
      map.setCenter({ lat: destination.center.latitude, lng: destination.center.longitude });
      map.setZoom(destination.overviewZoom);
      return;
    }
    if (displayStops.length === 1) {
      focusVisiblePoint(map, { lat: displayStops[0].latitude, lng: displayStops[0].longitude }, inspectorOpenRef.current);
      map.setZoom(14);
      return;
    }
    const bounds = new LatLngBounds();
    displayStops.forEach((stop) => bounds.extend({ lat: stop.latitude, lng: stop.longitude }));
    fitVisibleBounds(map, bounds, inspectorOpenRef.current);

    if (!drawRoute || pathStops.length < 2) return;
    if (routeRequestsPaused) {
      // Provider fetches stay paused (no date yet), but the caller may already
      // hold measured geometry (prefetch/convergence evidence) — draw the real
      // path solid where it exists, and only sketch the remaining hops with a
      // dashed connector. Neither costs an API call here.
      for (let pauseIndex = 0; pauseIndex < pathStops.length - 1; pauseIndex += 1) {
        const from = pathStops[pauseIndex];
        const to = pathStops[pauseIndex + 1];
        if (from.latitude === to.latitude && from.longitude === to.longitude) continue;
        const legKey = routeLegKey(from.id, to.id);
        const measured = (transitGeometry[pauseIndex] ?? []).map((point) => ({ lat: point.latitude, lng: point.longitude }));
        if (plannerRouteGeometryIsDrawable(measured)) {
          const outlineLine = new google.maps.Polyline({
            map,
            path: measured,
            clickable: false,
            ...legLineStyles.base.outline,
          });
          const strokeLine = new google.maps.Polyline({
            map,
            path: measured,
            clickable: false,
            ...legLineStyles.base.stroke,
          });
          routeLinesRef.current.push(outlineLine, strokeLine);
          registerLegLine(legKey, "outline", outlineLine);
          registerLegLine(legKey, "stroke", strokeLine);
          for (const bridge of accessBridgeSegments(measured, from, to)) {
            const bridgeLine = new google.maps.Polyline({
              map,
              path: bridge,
              ...buildPlannerMapConnectorLine(routeView),
            });
            routeLinesRef.current.push(bridgeLine);
            registerLegLine(legKey, "connector", bridgeLine);
          }
          continue;
        }
        const connectorLine = new google.maps.Polyline({
          map,
          path: [
            { lat: from.latitude, lng: from.longitude },
            { lat: to.latitude, lng: to.longitude },
          ],
          ...buildPlannerMapConnectorLine(routeView),
        });
        routeLinesRef.current.push(connectorLine);
        registerLegLine(legKey, "connector", connectorLine);
      }
      applyTimelineHover();
      onRouteGeometryRef.current([]);
      return;
    }

    const legs = pathStops.slice(0, -1).map((from, index) => ({ from, to: pathStops[index + 1], index }));
    async function drawRoutes() {
      if (renderSeqRef.current !== seq) return;
      setRouteState("loading");
      const specs = legs.map(({ from, to, index }) => {
        const mode = routeModes[index] ?? "transit";
        const rawDepartureTime = departureTimesRef.current[index] ?? "";
        const departureTime = usableDepartureTime(rawDepartureTime);
        const departureBucket = departureTime
          ? new Date(Math.floor(departureTime.getTime() / 900_000) * 900_000).toISOString()
          : rawDepartureTime ? "outside-window" : "now";
        const cacheKey = `${destination.id}:${destination.regionCode ?? "worldwide"}|${from.id}->${to.id}@${locale}:${mode}:${departureBucket}`;
        const cached = legCacheRef.current.get(cacheKey);
        return {
          id: `map-leg-${index}`,
          from,
          to,
          index,
          mode,
          rawDepartureTime,
          departureTime: (departureTime ?? new Date()).toISOString(),
          // Measured geometry supplied by the caller (convergence evidence or
          // the post-build prefetch) applies to any mode, not only transit.
          providedTransitPath: (transitGeometry[index] ?? []).map((point) => ({ lat: point.latitude, lng: point.longitude })),
          cacheKey,
          cached,
        };
      });

      const requested = new Map<string, { durationMinutes: number | null; encodedPolyline: string | null; status: string; fetchedAt: string | null }>();
      const remainingBudget = Math.max(0, PLANNING_BUDGET.routeEvents - routeBudgetRef.current.used);
      const requestableKeys = new Set(
        specs
          .filter((spec) => spec.mode !== "transit" && !spec.cached && !plannerRouteGeometryIsDrawable(spec.providedTransitPath))
          .slice(0, remainingBudget)
          .map((spec) => spec.cacheKey),
      );
      // Transit is fetched once by the convergence coordinator. The map may
      // spend only the remaining shared budget on walking/taxi geometry and
      // never feeds those display-only results back into feasibility.
      const modeGroups = (["walk", "taxi"] as const).map((mode) => ({
        mode,
        specs: specs.filter((spec) => spec.mode === mode && !spec.cached && requestableKeys.has(spec.cacheKey)),
      })).filter((group) => group.specs.length > 0);
      // Failed requests still consume the trip budget so a provider outage
      // cannot cause a render/retry loop to exceed the hard ceiling.
      routeBudgetRef.current.used += modeGroups.reduce((total, group) => total + group.specs.length, 0);
      // Switching days quickly used to leave the previous pass's requests
      // running: their answers were discarded by the sequence guard, but they
      // were already billed. A newer pass now cancels the older one.
      routeGeometryAbortRef.current?.abort();
      const geometryAbort = new AbortController();
      routeGeometryAbortRef.current = geometryAbort;
      await Promise.all(modeGroups.map(async ({ mode, specs: pending }) => {
        const legs = await requestMapRouteGeometry({
          legs: pending.map((spec) => ({
            id: spec.id,
            origin: { latitude: spec.from.latitude, longitude: spec.from.longitude },
            destination: { latitude: spec.to.latitude, longitude: spec.to.longitude },
            departureTime: spec.departureTime,
          })),
          languageCode: locale,
          mode,
          signal: geometryAbort.signal,
        });
        for (const [id, leg] of legs) requested.set(id, leg);
      }));

      const results = specs.map((spec) => {
        if (spec.mode === "transit" || plannerRouteGeometryIsDrawable(spec.providedTransitPath)) {
          return { ...spec, path: spec.providedTransitPath, minutes: null, fetchedAt: null };
        }
        if (spec.cached) return { ...spec, ...spec.cached };
        const live = requested.get(spec.id);
        const decoded = live?.status === "ok" && live.encodedPolyline
          ? decodeGooglePolyline(live.encodedPolyline).map((point) => ({ lat: point.latitude, lng: point.longitude }))
          : [];
        const result = { path: decoded, minutes: live?.durationMinutes ?? null, fetchedAt: live?.fetchedAt ?? null };
        if (decoded.length >= 2) legCacheRef.current.set(spec.cacheKey, result);
        return { ...spec, ...result };
      });
      if (renderSeqRef.current !== seq || !engineRef.current) return;

      let liveLegCount = 0;
      const routeBounds = new LatLngBounds();
      const geometry: Array<{ latitude: number; longitude: number }> = [];
      for (const result of results) {
        const legKey = routeLegKey(result.from.id, result.to.id);
        if (!plannerRouteGeometryIsDrawable(result.path)) {
          // v0.3 §14.4: a straight line must never present as the real route.
          // Unmeasured legs get an explicitly-dashed, thinner, fainter
          // connector so the day still reads as one sequence. Connectors are
          // display-only: they count neither toward liveLegCount nor toward
          // the measured geometry handed to onRouteGeometryRef.
          const connectorLine = new google.maps.Polyline({
            map,
            path: [
              { lat: result.from.latitude, lng: result.from.longitude },
              { lat: result.to.latitude, lng: result.to.longitude },
            ],
            ...buildPlannerMapConnectorLine(routeView),
          });
          routeLinesRef.current.push(connectorLine);
          registerLegLine(legKey, "connector", connectorLine);
          continue;
        }
        liveLegCount += 1;
        result.path.forEach((point: any) => routeBounds.extend(point));
        for (const point of result.path) {
          const previous = geometry.at(-1);
          if (!previous || previous.latitude !== point.lat || previous.longitude !== point.lng) {
            geometry.push({ latitude: point.lat, longitude: point.lng });
          }
        }
        const outlineLine = new google.maps.Polyline({
          map,
          path: result.path,
          clickable: false,
          ...legLineStyles.base.outline,
        });
        const strokeLine = new google.maps.Polyline({
          map,
          path: result.path,
          clickable: false,
          ...legLineStyles.base.stroke,
        });
        routeLinesRef.current.push(outlineLine, strokeLine);
        registerLegLine(legKey, "outline", outlineLine);
        registerLegLine(legKey, "stroke", strokeLine);
        for (const bridge of accessBridgeSegments(result.path, result.from, result.to)) {
          bridge.forEach((point) => routeBounds.extend(point));
          const bridgeLine = new google.maps.Polyline({
            map,
            path: bridge,
            ...buildPlannerMapConnectorLine(routeView),
          });
          routeLinesRef.current.push(bridgeLine);
          registerLegLine(legKey, "connector", bridgeLine);
        }
      }
      // Route lines were rebuilt; a leg the traveller is hovering right now
      // must regain its highlight on the fresh polylines.
      applyTimelineHover();
      if (liveLegCount === legs.length && dayLayerViews.length === 0) {
        displayStops.forEach((stop) => routeBounds.extend({ lat: stop.latitude, lng: stop.longitude }));
        fitVisibleBounds(map, routeBounds, inspectorOpenRef.current);
      }
      setRouteState(liveLegCount === legs.length ? "live" : liveLegCount > 0 ? "partial" : "unavailable");
      if (geometry.length >= 2) {
        const maximum = 12;
        const sampled = geometry.length <= maximum
          ? geometry
          : Array.from({ length: maximum }, (_, index) => geometry[Math.round(index * (geometry.length - 1) / (maximum - 1))]);
        onRouteGeometryRef.current(sampled);
      } else {
        onRouteGeometryRef.current([]);
      }
    }

    drawRoutes().catch(() => {
      if (renderSeqRef.current === seq) {
        setRouteState("unavailable");
        onRouteGeometryRef.current([]);
      }
    });
    // Redraw only when the day's stops actually change, not on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, routeSignature]);

  // All-days context is deliberately display-only. It consumes no provider
  // budget and draws only geometry the caller already has evidence for. The
  // active day is omitted here because the live pipeline above owns it.
  useEffect(() => {
    dayLayerChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    dayLayerLinesRef.current.forEach((line) => line.setMap(null));
    dayLayerChipsRef.current = [];
    dayLayerLinesRef.current = [];
    if (engineState !== "js" || !engineRef.current) return;

    const { google, map } = engineRef.current;
    for (const layer of dayLayerViews) {
      if (layer.active) continue;
      const appearance = {
        dayIndex: layer.dayIndex,
        dayNumber: layer.dayNumber,
        color: layer.color,
        active: false,
        pinOpacity: layer.pinOpacity,
        pinZIndex: layer.pinZIndex,
      };
      for (const segment of layer.drawableSegments) {
        dayLayerLinesRef.current.push(
          new google.maps.Polyline({
            clickable: false,
            map,
            path: segment,
            strokeColor: "#ffffff",
            strokeOpacity: layer.route.outlineOpacity,
            strokeWeight: layer.route.outlineWeight,
            zIndex: Math.max(1, layer.route.zIndex - 1),
          }),
          new google.maps.Polyline({
            clickable: false,
            map,
            path: segment,
            strokeColor: layer.route.color,
            strokeOpacity: layer.route.strokeOpacity,
            strokeWeight: layer.route.strokeWeight,
            zIndex: layer.route.zIndex,
          }),
        );
      }
      for (const segment of layer.connectorSegments) {
        // Legs without measured geometry stay visually connected via a dashed
        // display-only connector; never a solid line (spec §14.4).
        dayLayerLinesRef.current.push(
          new google.maps.Polyline({
            map,
            path: segment,
            ...buildPlannerMapConnectorLine(layer.route),
          }),
        );
      }
      for (const stop of layer.stops) {
        const chip = createChip(google, map, {
          position: { lat: stop.latitude, lng: stop.longitude },
          name: stop.name,
          pixelOffsetX: stop.kind === "hotel" ? 0 : ((stop.sequence ?? 1) % 2 === 0 ? -10 : 10),
          view: stop.pin,
          stopId: stop.id,
          dayAppearance: appearance,
          onClick: () => {
            suppressMapClickUntilRef.current = Date.now() + 250;
            if (onSelectDayStopRef.current) onSelectDayStopRef.current(layer.dayIndex, stop.id);
            else onSelectStopRef.current(stop.id);
          },
        });
        chip.setSelected(chip.stopId === selectedStopIdRef.current);
        dayLayerChipsRef.current.push(chip);
      }
    }
    applyTimelineHover();

    return () => {
      dayLayerChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      dayLayerLinesRef.current.forEach((line) => line.setMap(null));
      dayLayerChipsRef.current = [];
      dayLayerLinesRef.current = [];
    };
    // Stable numeric/content signature avoids rebuilding overlays when a
    // parent recreates equivalent day-layer arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, dayLayersSignature]);

  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const { map } = engineRef.current;
    const { LatLngBounds } = engineRef.current.maps.core;
    const fitCurrentView = () => {
      const points = [
        ...displayStops.map((stop) => ({ lat: stop.latitude, lng: stop.longitude })),
        ...dayLayerViews.flatMap((layer) => layer.stops.map((stop) => ({ lat: stop.latitude, lng: stop.longitude }))),
        ...foodPins.map((pin) => ({ lat: pin.latitude, lng: pin.longitude })),
        ...hotelPins.map((pin) => ({ lat: pin.latitude, lng: pin.longitude })),
        ...recommendationPins.map((pin) => ({ lat: pin.latitude, lng: pin.longitude })),
      ];
      if (points.length === 0) return;
      if (points.length === 1) {
        focusVisiblePoint(map, points[0], inspectorOpenRef.current);
        return;
      }
      const bounds = new LatLngBounds();
      points.forEach((point) => bounds.extend(point));
      fitVisibleBounds(map, bounds, inspectorOpenRef.current);
    };
    const frame = window.requestAnimationFrame(fitCurrentView);
    window.addEventListener("resize", fitCurrentView);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", fitCurrentView);
    };
    // This effect changes only the camera framing; it deliberately does not refetch routes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, stopsSignature, dayLayersSignature, foodSignature, hotelSignature, recommendationSignature, inspectorOpen]);

  useEffect(() => {
    chipsRef.current.forEach((chip) => chip.setSelected(chip.stopId === selectedStopId));
    dayLayerChipsRef.current.forEach((chip) => chip.setSelected(chip.stopId === selectedStopId));
    if (!selectedStopId || engineState !== "js" || !engineRef.current) return;
    const stop = displayStops.find((candidate) => candidate.id === selectedStopId)
      ?? dayLayerViews.flatMap((layer) => layer.stops).find((candidate) => candidate.id === selectedStopId);
    if (stop) focusVisiblePoint(
      engineRef.current.map,
      { lat: stop.latitude, lng: stop.longitude },
      inspectorOpenRef.current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopId, engineState, stopsSignature, dayLayersSignature]);

  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const { google, map } = engineRef.current;
    const { LatLngBounds } = engineRef.current.maps.core;
    foodChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    foodChipsRef.current = foodPins.map((pin) => createChip(google, map, {
      position: { lat: pin.latitude, lng: pin.longitude },
      name: pin.name,
      view: buildPlannerMapPinView({ kind: "meal", mealKind: pin.mealKind, locale }),
      dayAppearance: activeDayAppearance,
      pixelOffsetX: (pin.index - 1) * 30,
      stopId: `food-${pin.id}`,
      onClick: () => onSelectFoodRef.current(pin.slotId, pin.candidateId),
    }));
    if (foodPins.length > 0) {
      const bounds = new LatLngBounds();
      foodPins.forEach((pin) => bounds.extend({ lat: pin.latitude, lng: pin.longitude }));
      displayStops.forEach((stop) => bounds.extend({ lat: stop.latitude, lng: stop.longitude }));
      dayLayerViews.forEach((layer) => layer.stops.forEach((stop) => bounds.extend({ lat: stop.latitude, lng: stop.longitude })));
      fitVisibleBounds(map, bounds, inspectorOpenRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, foodSignature, dayLayersSignature]);

  // Hotel alternatives are a comparison overlay only. Keeping them in a
  // separate effect means opening the hotel panel never re-requests Routes.
  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const { google, map } = engineRef.current;
    hotelChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    hotelChipsRef.current = hotelPins.map((pin) => createChip(google, map, {
      position: { lat: pin.latitude, lng: pin.longitude },
      name: pin.name,
      view: buildPlannerMapPinView({ kind: "hotel", badgeText: pin.priceLabel, comparison: true, locale }),
      dayAppearance: activeDayAppearance,
      stopId: `hotel-${pin.id}`,
      onClick: () => onSelectHotelCandidateRef.current(pin.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, hotelSignature]);

  useEffect(() => {
    const selectedId = selectedHotelPinId ? `hotel-${selectedHotelPinId}` : null;
    hotelChipsRef.current.forEach((chip) => chip.setSelected(chip.stopId === selectedId));
  }, [selectedHotelPinId, hotelSignature]);

  useEffect(() => {
    const selectedId = selectedFoodPinId ? `food-${selectedFoodPinId}` : null;
    foodChipsRef.current.forEach((chip) => chip.setSelected(chip.stopId === selectedId));
  }, [selectedFoodPinId, foodSignature]);

  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const { google, map } = engineRef.current;
    recommendationChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    recommendationChipsRef.current = recommendationPins.map((pin) => createChip(google, map, {
      position: { lat: pin.latitude, lng: pin.longitude },
      name: pin.name,
      view: buildPlannerMapPinView({ kind: "filler", locale }),
      dayAppearance: activeDayAppearance,
      stopId: `recommendation-${pin.id}`,
      onClick: () => onSelectRecommendationRef.current(pin.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, recommendationSignature]);

  useEffect(() => {
    const selectedId = selectedRecommendationPinId ? `recommendation-${selectedRecommendationPinId}` : null;
    recommendationChipsRef.current.forEach((chip) => chip.setSelected(chip.stopId === selectedId));
  }, [selectedRecommendationPinId, recommendationSignature]);

  useEffect(() => {
    coordinatePickChipRef.current?.overlay.setMap(null);
    coordinatePickChipRef.current = null;
    if (engineState !== "js" || !engineRef.current || !coordinatePickActive || !coordinatePick) return;
    const { google, map } = engineRef.current;
    coordinatePickChipRef.current = createChip(google, map, {
      position: { lat: coordinatePick.latitude, lng: coordinatePick.longitude },
      name: locale === "ja" ? "指定する地点" : "Traveller-selected point",
      view: {
        ...buildPlannerMapPinView({ kind: "anchor", badgeText: "+", locale }),
        glyph: "manual",
        className: "planner-map-chip is-manual is-shape-manual",
        ariaKind: locale === "ja" ? "指定する地点" : "traveller-selected point",
      },
      stopId: "manual-coordinate-pick",
    });
    focusVisiblePoint(map, { lat: coordinatePick.latitude, lng: coordinatePick.longitude }, inspectorOpenRef.current);
    return () => {
      coordinatePickChipRef.current?.overlay.setMap(null);
      coordinatePickChipRef.current = null;
    };
    // The coordinate object is intentionally represented by its stable numeric
    // signature so an unrelated parent render does not recreate the overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinatePickActive, coordinatePickSignature, engineState, locale]);

  const displayedRouteState: RouteState = routeRequestsPaused
    ? routePauseReason === "date_required" ? "paused_date" : "loading"
    : routeState;
  const statusText = locale === "ja"
    ? { idle: "地図", paused_date: "日付未定 · 訪問順のみ", loading: "経路を取得中…", live: "経路データ取得済み", partial: "一部の経路のみ取得済み", unavailable: "経路データ未取得" }[displayedRouteState]
    : { idle: "Map", paused_date: "Date not set · visit order only", loading: "Fetching routes…", live: "Route data retrieved", partial: "Some route data unavailable", unavailable: "Route data unavailable" }[displayedRouteState];

  return (
    <>
      {/* The container stays mounted even while unavailable: the panel covers
          it, and a retry can reuse the same node instead of losing the map
          surface for the rest of the session. */}
      <div
        aria-hidden={engineState === "js" ? undefined : true}
        className={`planner-google-map${engineState === "js" ? " is-visible" : ""}${coordinatePickActive ? " is-coordinate-picking" : ""} is-day-${routeView.dayNumber}${dayActive ? " is-active-day" : " is-inactive-day"}`}
        data-day-color={routeView.color}
        data-day-index={routeView.dayIndex}
        ref={containerRef}
      />
      {engineState === "unavailable" ? (
        <div className="planner-map-provider-unavailable" data-reason={unavailableReason} role="status">
          <b>{locale === "ja" ? "地図を読み込めません" : "Map unavailable"}</b>
          <span>{locale === "ja"
            ? "旅程は引き続き利用できます。結果画面では「Google Mapsで開く」も利用できます。"
            : "You can keep using the planner. Open in Google Maps is also available on the results screen."}</span>
          {unavailableReason === "load" ? (
            <button
              className="planner-map-retry"
              onClick={() => {
                setEngineState("loading");
                setMapBootAttempt((attempt) => attempt + 1);
              }}
              type="button"
            >
              {locale === "ja" ? "地図を再読み込み" : "Reload the map"}
            </button>
          ) : null}
        </div>
      ) : null}
      {drawRoute && pathStops.length > 1 ? (
        <span aria-live="polite" className={`planner-route-status is-${displayedRouteState}`}><i aria-hidden="true" />{statusText}</span>
      ) : null}
    </>
  );
}
