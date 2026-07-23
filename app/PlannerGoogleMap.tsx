"use client";

/* Google Maps loads at runtime, so this file keeps the API surface deliberately narrow. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import type { RouteStop } from "../lib/route-optimizer";
import type { TransportMode } from "../lib/time-feasibility";
import { routeLegKey } from "../lib/trip-builder";

type MapLocale = "en" | "ja";
type RouteState = "idle" | "loading" | "live" | "partial" | "fallback";

export type FoodPin = {
  id: string;
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

type Props = {
  apiKey: string;
  base: RouteStop | null;
  /** Tonight's hotel when it differs from the morning base (nightly hotel mode). */
  endBase?: RouteStop | null;
  departureTimes: string[];
  drawRoute?: boolean;
  foodPins: FoodPin[];
  hotelPins: HotelPin[];
  inspectorOpen: boolean;
  locale: MapLocale;
  onLegDurations: (minutes: Record<string, number>) => void;
  onSelectFood: (candidateId: string) => void;
  onSelectHotel?: () => void;
  onSelectHotelCandidate: (candidateId: string) => void;
  onSelectStop: (stopId: string | null) => void;
  routeModes: TransportMode[];
  selectedFoodPinId: string | null;
  selectedHotelPinId: string | null;
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

const JAPAN_CENTER = { lat: 36.2048, lng: 138.2529 };

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
  const left = 442;
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

function createChip(
  google: any,
  map: any,
  options: {
    position: { lat: number; lng: number };
    badge: string;
    name: string;
    kind: "stop" | "hotel" | "hotel-option" | "food";
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
    else badge.textContent = options.badge;
    const label = document.createElement("span");
    label.textContent = options.name;
    element.append(badge, label);
    element.title = options.name;
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
    element.style.left = `${point.x}px`;
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
  drawRoute = true,
  foodPins,
  hotelPins,
  inspectorOpen,
  locale,
  onLegDurations,
  onSelectFood,
  onSelectHotel,
  onSelectHotelCandidate,
  onSelectStop,
  routeModes,
  selectedFoodPinId,
  selectedHotelPinId,
  selectedStopId,
  stops,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{ google: any; map: any; maps: any } | null>(null);
  const chipsRef = useRef<Chip[]>([]);
  const routeLinesRef = useRef<any[]>([]);
  const foodChipsRef = useRef<Chip[]>([]);
  const hotelChipsRef = useRef<Chip[]>([]);
  const legCacheRef = useRef<Map<string, { path: any[]; minutes: number | null }>>(new Map());
  const renderSeqRef = useRef(0);
  const departureTimesRef = useRef(departureTimes);
  const inspectorOpenRef = useRef(inspectorOpen);
  const onSelectFoodRef = useRef(onSelectFood);
  const onSelectHotelRef = useRef(onSelectHotel);
  const onSelectHotelCandidateRef = useRef(onSelectHotelCandidate);
  const onSelectStopRef = useRef(onSelectStop);
  const onLegDurationsRef = useRef(onLegDurations);
  const [engineState, setEngineState] = useState<"loading" | "js" | "embed">(apiKey ? "loading" : "embed");
  const [routeState, setRouteState] = useState<RouteState>("idle");

  useEffect(() => {
    departureTimesRef.current = departureTimes;
    inspectorOpenRef.current = inspectorOpen;
    onSelectFoodRef.current = onSelectFood;
    onSelectHotelRef.current = onSelectHotel;
    onSelectHotelCandidateRef.current = onSelectHotelCandidate;
    onSelectStopRef.current = onSelectStop;
    onLegDurationsRef.current = onLegDurations;
  });

  const finishBase = base && endBase && endBase.id !== base.id ? endBase : null;
  const displayStops = base ? [base, ...stops, ...(finishBase ? [finishBase] : [])] : stops;
  const pathStops = base && stops.length > 0 ? [base, ...stops, finishBase ?? base] : stops;
  const stopsSignature = `${locale}|${onSelectHotel ? "hotel-on" : "hotel-off"}|${displayStops.map((stop) => `${stop.id}@${stop.latitude.toFixed(5)},${stop.longitude.toFixed(5)}`).join("|")}`;
  const routeSignature = `${stopsSignature}|${drawRoute ? "route" : "pins"}|${routeModes.join(",")}|${departureTimes.join(",")}`;
  const foodSignature = foodPins.map((pin) => `${pin.id}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}`).join("|");
  const hotelSignature = hotelPins.map((pin) => `${pin.id}@${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}:${pin.priceLabel}`).join("|");

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
        const map = new Map(containerRef.current, {
          center: JAPAN_CENTER,
          zoom: 5,
          clickableIcons: false,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
          styles: warmMapStyle,
          backgroundColor: "#f4f4f5",
        });
        map.addListener("click", () => onSelectStopRef.current(null));
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
      map.setCenter(JAPAN_CENTER);
      map.setZoom(5);
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

    const legs = pathStops.slice(0, -1).map((from, index) => ({ from, to: pathStops[index + 1], index }));
    const dashedLegs = legs.map(({ from, to }) => new google.maps.Polyline({
      map,
      path: [
        { lat: from.latitude, lng: from.longitude },
        { lat: to.latitude, lng: to.longitude },
      ],
      strokeOpacity: 0,
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeOpacity: 0.5, strokeColor: "#9a9aa2", scale: 2.4 },
        offset: "0",
        repeat: "13px",
      }],
      zIndex: 3,
    }));
    routeLinesRef.current.push(...dashedLegs);

    async function drawRoutes() {
      const { Route } = await google.maps.importLibrary("routes");
      if (renderSeqRef.current !== seq) return;
      setRouteState("loading");
      const computeLeg = async (from: RouteStop, to: RouteStop, index: number) => {
        const mode = routeModes[index] ?? "transit";
        const rawDepartureTime = departureTimesRef.current[index] ?? "";
        const departureTime = usableDepartureTime(rawDepartureTime);
        const departureBucket = departureTime
          ? new Date(Math.floor(departureTime.getTime() / 900_000) * 900_000).toISOString()
          : rawDepartureTime ? "outside-window" : "now";
        const cacheKey = `${from.id}->${to.id}@${locale}:${mode}:${departureBucket}`;
        const cached = legCacheRef.current.get(cacheKey);
        if (cached) return { ...cached, mode, publishMinutes: mode === "transit" && (!rawDepartureTime || Boolean(departureTime)) };
        const travelMode = { walk: "WALKING", transit: "TRANSIT", taxi: "DRIVING" }[mode];
        const request = (fields: string[]) => Route.computeRoutes({
          origin: { lat: from.latitude, lng: from.longitude },
          destination: { lat: to.latitude, lng: to.longitude },
          travelMode,
          ...(mode === "transit" && departureTime
            ? { departureTime }
            : {}),
          ...(mode === "transit" ? { transitPreference: {
            allowedTransitModes: ["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"],
            routingPreference: "FEWER_TRANSFERS",
          } } : {}),
          region: "JP",
          language: locale,
          fields,
        });
        let routes;
        try {
          ({ routes } = await request(["path", "durationMillis"]));
        } catch {
          ({ routes } = await request(["path"]));
        }
        const route = routes?.[0];
        const path = route?.path ?? [];
        const rawMillis = route?.durationMillis;
        const millis = typeof rawMillis === "number" ? rawMillis : typeof rawMillis === "string" ? Number(rawMillis) : Number.NaN;
        const result = {
          path,
          minutes: Number.isFinite(millis) && millis > 0 ? Math.max(1, Math.round(millis / 60_000)) : null,
        };
        // First measurement wins for the session so schedule times stay put while the user explores.
        if (path.length >= 2) legCacheRef.current.set(cacheKey, result);
        return { ...result, mode, publishMinutes: mode === "transit" && (!rawDepartureTime || Boolean(departureTime)) };
      };

      const results = await Promise.all(legs.map(async ({ from, to, index }) => {
        try {
          return { from, to, index, ...(await computeLeg(from, to, index)) };
        } catch {
          return { from, to, index, path: [], minutes: null, mode: routeModes[index] ?? "transit", publishMinutes: false };
        }
      }));
      if (renderSeqRef.current !== seq || !engineRef.current) return;

      const durations: Record<string, number> = {};
      let liveLegCount = 0;
      const routeBounds = new LatLngBounds();
      for (const result of results) {
        if (result.minutes !== null && result.publishMinutes) durations[routeLegKey(result.from.id, result.to.id)] = result.minutes;
        if (result.path.length < 2) continue;
        liveLegCount += 1;
        dashedLegs[result.index]?.setMap(null);
        result.path.forEach((point: any) => routeBounds.extend(point));
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
      setRouteState(liveLegCount === legs.length ? "live" : liveLegCount > 0 ? "partial" : "fallback");
      if (Object.keys(durations).length > 0) onLegDurationsRef.current(durations);
    }

    drawRoutes().catch(() => {
      if (renderSeqRef.current === seq) setRouteState("fallback");
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
  }, [engineState, stopsSignature, foodSignature, hotelSignature, inspectorOpen]);

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
      // index -1 marks a confirmed meal pick, drawn with the fork glyph.
      badge: pin.index < 0 ? "F" : String(pin.index + 1),
      name: pin.name,
      kind: "food",
      stopId: `food-${pin.id}`,
      onClick: () => onSelectFoodRef.current(pin.id),
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

  const embedPoints = pathStops.length > 0
    ? pathStops.length <= 10 ? pathStops : [...pathStops.slice(0, 9), pathStops.at(-1)!]
    : [{ latitude: JAPAN_CENTER.lat, longitude: JAPAN_CENTER.lng, name: locale === "ja" ? "日本" : "Japan" }];
  const embedParams = new URLSearchParams({
    language: locale,
    points: embedPoints.map((stop) => `${stop.latitude},${stop.longitude}`).join("|"),
    labels: embedPoints.map((stop) => stop.name).join("|"),
    ...(pathStops.length === 0 ? { overview: "1", zoom: "5" } : {}),
  });

  const statusText = locale === "ja"
    ? { idle: "Googleマップ", loading: "実経路を取得中…", live: "Google実経路", partial: "一部は直線目安", fallback: "直線の目安" }[routeState]
    : { idle: "Google Maps", loading: "Fetching routes…", live: "Live Google routes", partial: "Some straight-line guides", fallback: "Straight-line guide" }[routeState];

  return (
    <>
      <iframe
        className="planner-map-embed"
        loading="eager"
        referrerPolicy="no-referrer-when-downgrade"
        src={`/api/map-embed?${embedParams.toString()}`}
        title={locale === "ja" ? "旅程のGoogleマップ" : "Itinerary on Google Maps"}
      />
      <div className={`planner-google-map${engineState === "js" ? " is-visible" : ""}`} ref={containerRef} />
      {drawRoute && pathStops.length > 1 ? (
        <span aria-live="polite" className={`planner-route-status is-${routeState}`}><i aria-hidden="true" />{statusText}</span>
      ) : null}
    </>
  );
}
