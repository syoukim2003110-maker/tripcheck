"use client";

/* Google Maps loads at runtime, so this file keeps the API surface deliberately narrow. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import { destinationName, type Destination } from "../lib/destinations";
import { decodeGooglePolyline } from "../lib/google-polyline";
import type { RouteStop } from "../lib/route-optimizer";
import type { TransportMode } from "../lib/time-feasibility";
import { PLANNING_BUDGET } from "../lib/planning-budget";
import { tripRequestHeaders } from "../lib/trip-request-identity";

type MapLocale = "en" | "ja";
type RouteState = "idle" | "loading" | "live" | "partial" | "unavailable";

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

type Props = {
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
  /** Already-fetched transit geometry, aligned to the visible physical legs. */
  transitGeometry: readonly (readonly { latitude: number; longitude: number }[] | null)[];
  /** Lets one unresolved occurrence be positioned without rebuilding the trip. */
  coordinatePickActive?: boolean;
  coordinatePick?: { latitude: number; longitude: number } | null;
  inspectorOpen: boolean;
  destination: Destination;
  locale: MapLocale;
  onRouteGeometry: (points: Array<{ latitude: number; longitude: number }>) => void;
  onPickCoordinate?: (point: { latitude: number; longitude: number }) => void;
  onSelectFood: (slotId: string, candidateId: string) => void;
  onSelectHotel?: () => void;
  onSelectHotelCandidate: (candidateId: string) => void;
  onSelectRecommendation: (candidateId: string) => void;
  onSelectStop: (stopId: string | null) => void;
  routeModes: TransportMode[];
  selectedFoodPinId: string | null;
  selectedHotelPinId: string | null;
  selectedRecommendationPinId: string | null;
  selectedStopId: string | null;
  stops: RouteStop[];
};

declare global {
  interface Window {
    google?: any;
    __tripcheckMapsPromise?: Promise<any>;
    __tripcheckMapsReady?: () => void;
  }
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
  if (window.google?.maps?.importLibrary) return window.google;
  if (!apiKey) throw new Error("maps_not_configured");
  if (!window.__tripcheckMapsPromise) {
    window.__tripcheckMapsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
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

function visibleMapPadding(map: any, inspectorOpen: boolean): MapPadding {
  const container = map.getDiv() as HTMLElement;
  const width = Math.max(320, container.clientWidth);
  const height = Math.max(320, container.clientHeight);
  const mobile = window.matchMedia("(max-width: 840px)").matches;
  if (mobile) {
    const top = 74;
    const preferredBottom = Math.round(height * (inspectorOpen ? 0.64 : 0.54));
    return { top, right: 18, bottom: Math.min(preferredBottom, Math.max(100, height - top - 140)), left: 18 };
  }
  const left = 24;
  const right = inspectorOpen ? Math.min(408, Math.max(24, width - left - 160)) : 24;
  return { top: 92, right, bottom: 72, left };
}

function fitVisibleBounds(map: any, bounds: any, inspectorOpen: boolean) {
  map.fitBounds(bounds, visibleMapPadding(map, inspectorOpen));
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
    badge: string;
    name: string;
    kind: "stop" | "hotel" | "hotel-option" | "food" | "food-lunch" | "food-dinner" | "food-both" | "recommendation" | "manual";
    pixelOffsetX?: number;
    stopId: string;
    onClick?: () => void;
  },
): Chip {
  const overlay = new google.maps.OverlayView();
  let element: HTMLButtonElement | null = null;
  overlay.onAdd = function onAdd() {
    element = document.createElement("button");
    element.type = "button";
    element.className = `planner-map-chip is-${options.kind}`;
    const badge = document.createElement("i");
    if (options.kind === "hotel") badge.innerHTML = HOTEL_BADGE_SVG;
    else if (options.kind === "food" && options.badge === "F") badge.innerHTML = MEAL_BADGE_SVG;
    else if (options.kind === "food-lunch") badge.innerHTML = LUNCH_BADGE_SVG;
    else if (options.kind === "food-dinner") badge.innerHTML = DINNER_BADGE_SVG;
    else if (options.kind === "food-both") badge.innerHTML = MEAL_BADGE_SVG;
    else if (options.kind === "recommendation") badge.innerHTML = RECOMMENDATION_BADGE_SVG;
    else badge.textContent = options.badge;
    const label = document.createElement("span");
    label.textContent = options.name;
    element.append(badge, label);
    element.title = options.name;
    element.setAttribute("aria-label", `${options.name} ${options.badge}`);
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
    setSelected: (selected: boolean) => element?.classList.toggle("is-selected", selected),
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
  transitGeometry,
  coordinatePickActive = false,
  coordinatePick = null,
  inspectorOpen,
  locale,
  onRouteGeometry,
  onPickCoordinate,
  onSelectFood,
  onSelectHotel,
  onSelectHotelCandidate,
  onSelectRecommendation,
  onSelectStop,
  routeModes,
  selectedFoodPinId,
  selectedHotelPinId,
  selectedRecommendationPinId,
  selectedStopId,
  stops,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The opening view is fixed at mount; once a country or a stop set exists,
  // the recentre effect below owns where the map looks.
  const openingViewRef = useRef(destination);
  const engineRef = useRef<{ google: any; map: any; maps: any } | null>(null);
  const chipsRef = useRef<Chip[]>([]);
  const routeLinesRef = useRef<any[]>([]);
  const foodChipsRef = useRef<Chip[]>([]);
  const hotelChipsRef = useRef<Chip[]>([]);
  const recommendationChipsRef = useRef<Chip[]>([]);
  const coordinatePickChipRef = useRef<Chip | null>(null);
  const legCacheRef = useRef<Map<string, { path: any[]; minutes: number | null; fetchedAt: string | null }>>(new Map());
  const routeBudgetRef = useRef({ key: routeBudgetKey, used: routeBudgetUsed });
  const renderSeqRef = useRef(0);
  const departureTimesRef = useRef(departureTimes);
  const inspectorOpenRef = useRef(inspectorOpen);
  const onSelectFoodRef = useRef(onSelectFood);
  const onSelectHotelRef = useRef(onSelectHotel);
  const onSelectHotelCandidateRef = useRef(onSelectHotelCandidate);
  const onSelectRecommendationRef = useRef(onSelectRecommendation);
  const onSelectStopRef = useRef(onSelectStop);
  const onRouteGeometryRef = useRef(onRouteGeometry);
  const onPickCoordinateRef = useRef(onPickCoordinate);
  const coordinatePickActiveRef = useRef(coordinatePickActive);
  const [engineState, setEngineState] = useState<"loading" | "js" | "embed">(apiKey ? "loading" : "embed");
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
    onRouteGeometryRef.current = onRouteGeometry;
    onPickCoordinateRef.current = onPickCoordinate;
    coordinatePickActiveRef.current = coordinatePickActive;
  });

  const finishBase = base && endBase && endBase.id !== base.id ? endBase : null;
  const displayStops = base ? [base, ...stops, ...(finishBase ? [finishBase] : [])] : stops;
  const pathStops = base && stops.length > 0 ? [base, ...stops, finishBase ?? base] : stops;
  const stopsSignature = `${destination.id}:${destination.regionCode ?? "worldwide"}|${locale}|${onSelectHotel ? "hotel-on" : "hotel-off"}|${displayStops.map((stop) => `${stop.id}@${stop.latitude.toFixed(5)},${stop.longitude.toFixed(5)}`).join("|")}`;
  const transitGeometrySignature = transitGeometry.map((points) => points
    ? points.map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`).join(";")
    : "-").join("|");
  const routeSignature = `${routeBudgetKey}|${stopsSignature}|${drawRoute ? "route" : "pins"}|${routeRequestsPaused ? "paused" : "ready"}|${routeModes.join(",")}|${departureTimes.join(",")}|${transitGeometrySignature}`;
  const foodSignature = foodPins.map((pin) => `${pin.id}:${pin.mealKind}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}`).join("|");
  const hotelSignature = hotelPins.map((pin) => `${pin.id}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}:${pin.priceLabel}`).join("|");
  const recommendationSignature = recommendationPins.map((pin) => `${pin.id}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}`).join("|");
  const coordinatePickSignature = coordinatePick
    ? `${coordinatePick.latitude.toFixed(6)},${coordinatePick.longitude.toFixed(6)}`
    : "none";

  useEffect(() => {
    let cancelled = false;
    let tilesListener: any = null;
    async function boot() {
      if (!containerRef.current) return;
      try {
        const google = await loadGoogleMaps(apiKey);
        const [{ Map }, core] = await Promise.all([
          google.maps.importLibrary("maps"),
          google.maps.importLibrary("core"),
        ]);
        if (cancelled || !containerRef.current) return;
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
          styles: warmMapStyle,
          backgroundColor: "#f4f4f5",
        });
        map.addListener("click", (event: any) => {
          onSelectStopRef.current(null);
          if (!coordinatePickActiveRef.current) return;
          const latitude = event?.latLng?.lat?.();
          const longitude = event?.latLng?.lng?.();
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
          onPickCoordinateRef.current?.({ latitude, longitude });
        });
        engineRef.current = { google, map, maps: { core } };
        tilesListener = google.maps.event.addListenerOnce(map, "tilesloaded", () => {
          if (!cancelled) setEngineState("js");
        });
      } catch {
        if (!cancelled) setEngineState("embed");
      }
    }
    void boot();
    return () => {
      cancelled = true;
      chipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      foodChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      hotelChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      recommendationChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
      coordinatePickChipRef.current?.overlay.setMap(null);
      coordinatePickChipRef.current = null;
      routeLinesRef.current.forEach((line) => line.setMap(null));
      if (tilesListener) tilesListener.remove();
      engineRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const seq = ++renderSeqRef.current;
    const { google, map } = engineRef.current;
    const { LatLngBounds } = engineRef.current.maps.core;

    chipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    chipsRef.current = [];
    routeLinesRef.current.forEach((line) => line.setMap(null));
    routeLinesRef.current = [];

    chipsRef.current = displayStops.map((stop, index) => {
      const isHotel = Boolean(base) && (index === 0 || (Boolean(finishBase) && index === displayStops.length - 1));
      const selectHotel = onSelectHotelRef.current;
      return createChip(google, map, {
        position: { lat: stop.latitude, lng: stop.longitude },
        badge: isHotel ? "H" : String(base ? index : index + 1),
        name: stop.name,
        kind: isHotel ? "hotel" : "stop",
        stopId: stop.id,
        onClick: isHotel ? (selectHotel ? () => selectHotel() : undefined) : () => onSelectStopRef.current(stop.id),
      });
    });

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
          providedTransitPath: mode === "transit"
            ? (transitGeometry[index] ?? []).map((point) => ({ lat: point.latitude, lng: point.longitude }))
            : [],
          cacheKey,
          cached,
        };
      });

      const requested = new Map<string, { durationMinutes: number | null; encodedPolyline: string | null; status: string; fetchedAt: string | null }>();
      const remainingBudget = Math.max(0, PLANNING_BUDGET.routeEvents - routeBudgetRef.current.used);
      const requestableKeys = new Set(
        specs.filter((spec) => spec.mode !== "transit" && !spec.cached).slice(0, remainingBudget).map((spec) => spec.cacheKey),
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
      await Promise.all(modeGroups.map(async ({ mode, specs: pending }) => {
        try {
          const response = await fetch("/api/live-routes", {
            method: "POST",
            headers: tripRequestHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              legs: pending.map((spec) => ({
                id: spec.id,
                origin: { latitude: spec.from.latitude, longitude: spec.from.longitude },
                destination: { latitude: spec.to.latitude, longitude: spec.to.longitude },
                departureTime: spec.departureTime,
              })),
              languageCode: locale,
              travelMode: mode === "walk" ? "WALK" : mode === "taxi" ? "DRIVE" : "TRANSIT",
            }),
          });
          const payload = await response.json().catch(() => null) as { fetchedAt?: unknown; legs?: Array<{ id?: unknown; durationMinutes?: unknown; encodedPolyline?: unknown; status?: unknown }> } | null;
          if (!response.ok || !Array.isArray(payload?.legs)) return;
          for (const leg of payload.legs) {
            if (typeof leg.id !== "string") continue;
            requested.set(leg.id, {
              durationMinutes: typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes) ? leg.durationMinutes : null,
              encodedPolyline: typeof leg.encodedPolyline === "string" ? leg.encodedPolyline : null,
              status: typeof leg.status === "string" ? leg.status : "unavailable",
              fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : null,
            });
          }
        } catch {
          // Pins and the map stay usable; no invented line is substituted.
        }
      }));

      const results = specs.map((spec) => {
        if (spec.mode === "transit") {
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
        if (result.path.length < 2) continue;
        liveLegCount += 1;
        result.path.forEach((point: any) => routeBounds.extend(point));
        for (const point of result.path) {
          const previous = geometry.at(-1);
          if (!previous || previous.latitude !== point.lat || previous.longitude !== point.lng) {
            geometry.push({ latitude: point.lat, longitude: point.lng });
          }
        }
        const routeColor = { walk: "#2f8878", transit: "#e2634e", taxi: "#6f5aa8" }[result.mode];
        routeLinesRef.current.push(
          new google.maps.Polyline({ map, path: result.path, strokeColor: "#ffffff", strokeOpacity: 0.92, strokeWeight: 9, zIndex: 4 }),
          new google.maps.Polyline({ map, path: result.path, strokeColor: routeColor, strokeOpacity: 0.95, strokeWeight: 5, zIndex: 5 }),
        );
      }
      if (liveLegCount === legs.length) {
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

  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const { map } = engineRef.current;
    const { LatLngBounds } = engineRef.current.maps.core;
    const fitCurrentView = () => {
      const points = [
        ...displayStops.map((stop) => ({ lat: stop.latitude, lng: stop.longitude })),
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
  }, [engineState, stopsSignature, foodSignature, hotelSignature, recommendationSignature, inspectorOpen]);

  useEffect(() => {
    chipsRef.current.forEach((chip) => chip.setSelected(chip.stopId === selectedStopId));
    if (!selectedStopId || engineState !== "js" || !engineRef.current) return;
    const stop = displayStops.find((candidate) => candidate.id === selectedStopId);
    if (stop) focusVisiblePoint(
      engineRef.current.map,
      { lat: stop.latitude, lng: stop.longitude },
      inspectorOpenRef.current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopId, engineState, stopsSignature]);

  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const { google, map } = engineRef.current;
    const { LatLngBounds } = engineRef.current.maps.core;
    foodChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    foodChipsRef.current = foodPins.map((pin) => createChip(google, map, {
      position: { lat: pin.latitude, lng: pin.longitude },
      badge: String(pin.index + 1),
      name: pin.name,
      kind: pin.mealKind === "lunch" ? "food-lunch" : pin.mealKind === "dinner" ? "food-dinner" : "food-both",
      pixelOffsetX: (pin.index - 1) * 30,
      stopId: `food-${pin.id}`,
      onClick: () => onSelectFoodRef.current(pin.slotId, pin.candidateId),
    }));
    if (foodPins.length > 0) {
      const bounds = new LatLngBounds();
      foodPins.forEach((pin) => bounds.extend({ lat: pin.latitude, lng: pin.longitude }));
      displayStops.forEach((stop) => bounds.extend({ lat: stop.latitude, lng: stop.longitude }));
      fitVisibleBounds(map, bounds, inspectorOpenRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState, foodSignature]);

  // Hotel alternatives are a comparison overlay only. Keeping them in a
  // separate effect means opening the hotel panel never re-requests Routes.
  useEffect(() => {
    if (engineState !== "js" || !engineRef.current) return;
    const { google, map } = engineRef.current;
    hotelChipsRef.current.forEach((chip) => chip.overlay.setMap(null));
    hotelChipsRef.current = hotelPins.map((pin) => createChip(google, map, {
      position: { lat: pin.latitude, lng: pin.longitude },
      badge: pin.priceLabel,
      name: pin.name,
      kind: "hotel-option",
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
      badge: String(pin.index + 1),
      name: pin.name,
      kind: "recommendation",
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
      badge: "+",
      name: locale === "ja" ? "指定する地点" : "Traveller-selected point",
      kind: "manual",
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

  const embedPoints = pathStops.length > 0
    ? pathStops.length <= 10 ? pathStops : [...pathStops.slice(0, 9), pathStops.at(-1)!]
    : [{
      latitude: destination.center.latitude,
      longitude: destination.center.longitude,
      name: destinationName(destination, locale),
    }];
  const embedParams = new URLSearchParams({
    language: locale,
    points: embedPoints.map((stop) => `${stop.latitude},${stop.longitude}`).join("|"),
    labels: embedPoints.map((stop) => stop.name).join("|"),
    ...(pathStops.length === 0 ? { overview: "1", zoom: String(destination.overviewZoom) } : {}),
    ...(destination.id === "worldwide" ? {} : { destination: destination.id }),
  });

  const statusText = locale === "ja"
    ? { idle: "地図", loading: "経路を取得中…", live: "経路データ取得済み", partial: "一部の経路のみ取得済み", unavailable: "経路データ未取得" }[routeState]
    : { idle: "Map", loading: "Fetching routes…", live: "Route data retrieved", partial: "Some route data unavailable", unavailable: "Route data unavailable" }[routeState];

  return (
    <>
      <iframe
        className="planner-map-embed"
        loading="eager"
        referrerPolicy="no-referrer-when-downgrade"
        src={`/api/map-embed?${embedParams.toString()}`}
        title={locale === "ja" ? "旅程のGoogleマップ" : "Itinerary on Google Maps"}
      />
      <div className={`planner-google-map${engineState === "js" ? " is-visible" : ""}${coordinatePickActive ? " is-coordinate-picking" : ""}`} ref={containerRef} />
      {drawRoute && pathStops.length > 1 ? (
        <span aria-live="polite" className={`planner-route-status is-${routeState}`}><i aria-hidden="true" />{statusText}</span>
      ) : null}
    </>
  );
}
