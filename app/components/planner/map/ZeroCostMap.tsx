"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker } from "maplibre-gl";
// The old planner's map only: the booklet does not carry MapLibre's styles.
import "maplibre-gl/dist/maplibre-gl.css";
import type { PlannerGoogleMapProps } from "../../../PlannerGoogleMap";
import {
  buildPlannerMapDayLayerViews,
  type PlannerMapDayLayer,
  type PlannerMapDayLayerView,
  type PlannerMapDayLayerStop,
} from "../../../../lib/planner-map-model";

type Coordinate = { latitude: number; longitude: number };

type ZeroCostMapProps = {
  locale: "en" | "ja";
  destination: PlannerGoogleMapProps["destination"];
  dayIndex: number;
  dayLayers: readonly PlannerMapDayLayer[];
  selectedStopId: string | null;
  selectedFoodPinId: string | null;
  selectedHotelPinId: string | null;
  selectedRecommendationPinId: string | null;
  foodPins: PlannerGoogleMapProps["foodPins"];
  hotelPins: PlannerGoogleMapProps["hotelPins"];
  recommendationPins: PlannerGoogleMapProps["recommendationPins"];
  coordinatePickActive: boolean;
  coordinatePick: PlannerGoogleMapProps["coordinatePick"];
  onPickCoordinate: NonNullable<PlannerGoogleMapProps["onPickCoordinate"]>;
  onSelectDayStop: NonNullable<PlannerGoogleMapProps["onSelectDayStop"]>;
  onSelectFood: PlannerGoogleMapProps["onSelectFood"];
  onSelectHotelCandidate: PlannerGoogleMapProps["onSelectHotelCandidate"];
  onSelectRecommendation: PlannerGoogleMapProps["onSelectRecommendation"];
};

const WIDTH = 1000;
const HEIGHT = 760;
const EDGE = 86;
const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAP_LOAD_TIMEOUT_MS = 12_000;
const MEASURED_SOURCE_ID = "tripcheck-measured-routes";
const CONNECTOR_SOURCE_ID = "tripcheck-estimated-connectors";

type ProviderStatus = "loading" | "ready" | "failed";

function validPoint(point: Coordinate | null | undefined): point is Coordinate {
  return Boolean(point
    && Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && point.longitude >= -180
    && point.longitude <= 180);
}

function boundsFor(points: readonly Coordinate[], fallback: Coordinate) {
  const usable = points.filter(validPoint);
  if (usable.length === 0) usable.push(fallback);
  let minLat = Math.min(...usable.map((point) => point.latitude));
  let maxLat = Math.max(...usable.map((point) => point.latitude));
  let minLng = Math.min(...usable.map((point) => point.longitude));
  let maxLng = Math.max(...usable.map((point) => point.longitude));
  const latitudePad = Math.max(0.018, (maxLat - minLat) * 0.18);
  const longitudePad = Math.max(0.025, (maxLng - minLng) * 0.18);
  minLat -= latitudePad;
  maxLat += latitudePad;
  minLng -= longitudePad;
  maxLng += longitudePad;
  return { minLat, maxLat, minLng, maxLng };
}

function project(point: Coordinate, bounds: ReturnType<typeof boundsFor>) {
  const x = EDGE + ((point.longitude - bounds.minLng) / Math.max(0.000001, bounds.maxLng - bounds.minLng)) * (WIDTH - EDGE * 2);
  const y = EDGE + ((bounds.maxLat - point.latitude) / Math.max(0.000001, bounds.maxLat - bounds.minLat)) * (HEIGHT - EDGE * 2);
  return { x, y };
}

function unproject(point: { x: number; y: number }, bounds: ReturnType<typeof boundsFor>) {
  return {
    latitude: bounds.maxLat - ((point.y - EDGE) / (HEIGHT - EDGE * 2)) * (bounds.maxLat - bounds.minLat),
    longitude: bounds.minLng + ((point.x - EDGE) / (WIDTH - EDGE * 2)) * (bounds.maxLng - bounds.minLng),
  };
}

function pathData(points: readonly { lat: number; lng: number }[], bounds: ReturnType<typeof boundsFor>) {
  return points.map((point, index) => {
    const projected = project({ latitude: point.lat, longitude: point.lng }, bounds);
    return `${index === 0 ? "M" : "L"}${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
  }).join(" ");
}

function markerGlyph(stop: PlannerMapDayLayerStop, sequence: number) {
  if (stop.kind === "hotel") return "H";
  if (stop.kind === "meal") return "●";
  if (stop.kind === "filler") return "✦";
  if (stop.kind === "warning") return "!";
  return String(stop.sequence ?? sequence);
}

function niceScaleKilometres(bounds: ReturnType<typeof boundsFor>) {
  const middleLatitude = (bounds.minLat + bounds.maxLat) / 2;
  const totalKilometres = Math.max(0.2, (bounds.maxLng - bounds.minLng) * 111.32 * Math.cos(middleLatitude * Math.PI / 180));
  const target = totalKilometres * 0.16;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return Math.max(0.1, step * magnitude);
}

function keyActivates(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function routeFeatureCollection(views: readonly PlannerMapDayLayerView[], measured: boolean) {
  return {
    type: "FeatureCollection" as const,
    features: views.flatMap((view) => (
      measured ? view.drawableSegments : view.connectorSegments
    ).map((segment) => ({
      type: "Feature" as const,
      properties: {
        color: view.color,
        opacity: measured ? (view.active ? 0.96 : 0.3) : (view.active ? 0.72 : 0.24),
        width: measured ? (view.active ? 5.5 : 2.5) : (view.active ? 3 : 2),
      },
      geometry: {
        type: "LineString" as const,
        coordinates: segment.map((point) => [point.lng, point.lat]),
      },
    }))),
  };
}

function setMapSourceData(map: MapLibreMap, sourceId: string, data: ReturnType<typeof routeFeatureCollection>) {
  const source = map.getSource(sourceId);
  if (source && "setData" in source) {
    (source as GeoJSONSource).setData(data);
    return false;
  }
  map.addSource(sourceId, { type: "geojson", data });
  return true;
}

function markerButton(input: {
  ariaLabel: string;
  className: string;
  color: string;
  glyph: string;
  label: string;
  onSelect: () => void;
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = input.className;
  button.style.setProperty("--zero-pin-color", input.color);
  button.setAttribute("aria-label", input.ariaLabel);
  button.title = input.label;
  const glyph = document.createElement("span");
  glyph.textContent = input.glyph;
  glyph.setAttribute("aria-hidden", "true");
  const label = document.createElement("small");
  label.textContent = input.label;
  label.setAttribute("aria-hidden", "true");
  button.append(glyph, label);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    input.onSelect();
  });
  return button;
}

/**
 * A key-free geographic overview backed by OpenFreeMap tiles. Coordinates
 * stay truthful; provider geometry is solid, while an unmeasured visit order
 * is always dashed. Opening the map does contact tiles.openfreemap.org, but it
 * never performs paid geocoding or route calls. Until those tiles load — and
 * whenever they fail — the same real coordinates remain visible in local SVG.
 */
export default function ZeroCostMap({
  locale,
  destination,
  dayIndex,
  dayLayers,
  selectedStopId,
  selectedFoodPinId,
  selectedHotelPinId,
  selectedRecommendationPinId,
  foodPins,
  hotelPins,
  recommendationPins,
  coordinatePickActive,
  coordinatePick,
  onPickCoordinate,
  onSelectDayStop,
  onSelectFood,
  onSelectHotelCandidate,
  onSelectRecommendation,
}: ZeroCostMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>("loading");
  const [providerAttempt, setProviderAttempt] = useState(0);
  const views = useMemo(() => buildPlannerMapDayLayerViews(dayLayers, { activeDayIndex: dayIndex, locale }), [dayIndex, dayLayers, locale]);
  const measuredRoutes = useMemo(() => routeFeatureCollection(views, true), [views]);
  const connectorRoutes = useMemo(() => routeFeatureCollection(views, false), [views]);
  const allPoints = useMemo<Coordinate[]>(() => [
    ...views.flatMap((view) => view.stops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude }))),
    ...foodPins.filter(validPoint),
    ...hotelPins.filter(validPoint),
    ...recommendationPins.filter(validPoint),
    ...(validPoint(coordinatePick) ? [coordinatePick] : []),
  ], [coordinatePick, foodPins, hotelPins, recommendationPins, views]);
  const bounds = useMemo(() => boundsFor(allPoints, destination.center), [allPoints, destination.center]);
  const scaleKilometres = niceScaleKilometres(bounds);
  const longitudeSpanKilometres = Math.max(0.2, (bounds.maxLng - bounds.minLng) * 111.32 * Math.cos(((bounds.minLat + bounds.maxLat) / 2) * Math.PI / 180));
  const scaleWidth = Math.max(36, Math.min(150, (scaleKilometres / longitudeSpanKilometres) * (WIDTH - EDGE * 2)));

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    let cancelled = false;
    let styleReady = false;
    let map: MapLibreMap | null = null;
    const timeout = window.setTimeout(() => {
      if (!styleReady && !cancelled) setProviderStatus("failed");
    }, MAP_LOAD_TIMEOUT_MS);
    const handleMapError = () => {
      if (!cancelled && !styleReady) setProviderStatus("failed");
    };
    const handleOffline = () => setProviderStatus("failed");

    setProviderStatus("loading");
    window.addEventListener("offline", handleOffline);
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled) return;
      maplibreRef.current = maplibre;
      // A static export hashes the worker's file name but not the sibling
      // module the worker imports, so the bundled worker 404s and the basemap
      // stays blank. The static build ships an unhashed worker pair and
      // points MapLibre at it; other builds keep the bundler's own worker.
      const workerUrl = process.env.NEXT_PUBLIC_MAPLIBRE_WORKER_URL;
      if (workerUrl) maplibre.setWorkerUrl(workerUrl);
      map = new maplibre.Map({
        attributionControl: { compact: true },
        center: [destination.center.longitude, destination.center.latitude],
        container,
        fadeDuration: 0,
        style: OPEN_FREE_MAP_STYLE,
        zoom: 8,
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      // `load` waits for every source needed by the current viewport. A slow
      // glyph or secondary source can therefore keep a perfectly usable map
      // hidden. `style.load` is the correct hand-off: the styled canvas and
      // our real-coordinate overlays can render immediately. An error before
      // that hand-off uses the SVG fallback; later tile or glyph errors stay
      // isolated instead of hiding an otherwise usable map.
      map.once("style.load", () => {
        styleReady = true;
        window.clearTimeout(timeout);
        if (!cancelled) setProviderStatus("ready");
      });
      map.on("error", handleMapError);
    }).catch(handleMapError);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("offline", handleOffline);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [destination.center.latitude, destination.center.longitude, providerAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (providerStatus !== "ready" || !map) return;

    const measuredIsNew = setMapSourceData(map, MEASURED_SOURCE_ID, measuredRoutes);
    if (measuredIsNew) {
      map.addLayer({
        id: `${MEASURED_SOURCE_ID}-outline`,
        type: "line",
        source: MEASURED_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-opacity": ["get", "opacity"],
          "line-width": ["+", ["get", "width"], 5],
        },
      });
      map.addLayer({
        id: `${MEASURED_SOURCE_ID}-stroke`,
        type: "line",
        source: MEASURED_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": ["get", "opacity"],
          "line-width": ["get", "width"],
        },
      });
    }

    const connectorsAreNew = setMapSourceData(map, CONNECTOR_SOURCE_ID, connectorRoutes);
    if (connectorsAreNew) {
      map.addLayer({
        id: `${CONNECTOR_SOURCE_ID}-stroke`,
        type: "line",
        source: CONNECTOR_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-dasharray": [2, 3],
          "line-opacity": ["get", "opacity"],
          "line-width": ["get", "width"],
        },
      });
    }
  }, [connectorRoutes, measuredRoutes, providerStatus]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (providerStatus !== "ready" || !map || !maplibre) return;

    markersRef.current.forEach((marker) => marker.remove());
    const markers: Marker[] = [];
    const addMarker = (coordinate: Coordinate, element: HTMLButtonElement) => {
      if (!validPoint(coordinate)) return;
      markers.push(new maplibre.Marker({ anchor: "center", element })
        .setLngLat([coordinate.longitude, coordinate.latitude])
        .addTo(map));
    };

    views.forEach((view) => view.stops.forEach((stop, index) => {
      addMarker(stop, markerButton({
        ariaLabel: `${stop.name}, ${locale === "ja" ? `${view.dayNumber}日目` : `day ${view.dayNumber}`}`,
        className: `planner-openfree-pin is-${stop.kind ?? "anchor"}${selectedStopId === stop.id ? " is-selected" : ""}${view.active ? " is-active-day" : ""}`,
        color: view.color,
        glyph: markerGlyph(stop, index + 1),
        label: stop.name,
        onSelect: () => onSelectDayStop(view.dayIndex, stop.id),
      }));
    }));
    foodPins.filter(validPoint).forEach((pin) => addMarker(pin, markerButton({
      ariaLabel: pin.name,
      className: `planner-openfree-pin is-food${selectedFoodPinId === pin.id ? " is-selected" : ""}`,
      color: "#e06f43",
      glyph: "●",
      label: pin.name,
      onSelect: () => onSelectFood(pin.slotId, pin.candidateId),
    })));
    hotelPins.filter(validPoint).forEach((pin) => addMarker(pin, markerButton({
      ariaLabel: pin.name,
      className: `planner-openfree-pin is-hotel${selectedHotelPinId === pin.id ? " is-selected" : ""}`,
      color: "#157a46",
      glyph: "H",
      label: pin.name,
      onSelect: () => onSelectHotelCandidate(pin.id),
    })));
    recommendationPins.filter(validPoint).forEach((pin) => addMarker(pin, markerButton({
      ariaLabel: pin.name,
      className: `planner-openfree-pin is-recommendation${selectedRecommendationPinId === pin.id ? " is-selected" : ""}`,
      color: "#66509f",
      glyph: "✦",
      label: pin.name,
      onSelect: () => onSelectRecommendation(pin.id),
    })));
    markersRef.current = markers;
    return () => {
      markers.forEach((marker) => marker.remove());
      if (markersRef.current === markers) markersRef.current = [];
    };
  }, [foodPins, hotelPins, locale, onSelectDayStop, onSelectFood, onSelectHotelCandidate, onSelectRecommendation, providerStatus, recommendationPins, selectedFoodPinId, selectedHotelPinId, selectedRecommendationPinId, selectedStopId, views]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    const points = allPoints.filter(validPoint);
    if (providerStatus !== "ready" || !map || !maplibre || points.length === 0) return;
    if (points.length === 1) {
      map.jumpTo({ center: [points[0].longitude, points[0].latitude], zoom: 12 });
      return;
    }
    const fitted = new maplibre.LngLatBounds();
    points.forEach((point) => fitted.extend([point.longitude, point.latitude]));
    map.fitBounds(fitted, { duration: 0, maxZoom: 13, padding: { top: 112, right: 72, bottom: 92, left: 72 } });
  }, [allPoints, providerStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (providerStatus !== "ready" || !map) return;
    map.getCanvas().style.cursor = coordinatePickActive ? "crosshair" : "";
    if (!coordinatePickActive) return;
    const pick = (event: MapMouseEvent) => onPickCoordinate({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    map.on("click", pick);
    return () => { map.off("click", pick); };
  }, [coordinatePickActive, onPickCoordinate, providerStatus]);

  function chooseFromMap(event: MouseEvent<SVGSVGElement>) {
    if (!coordinatePickActive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * HEIGHT,
    };
    onPickCoordinate(unproject(point, bounds));
  }

  return (
    <div
      className={`planner-zero-map is-provider-${providerStatus}${coordinatePickActive ? " is-coordinate-picking" : ""}`}
      data-map-provider={providerStatus === "ready" ? "openfreemap" : "local-svg"}
      data-map-provider-state={providerStatus}
    >
      <div
        aria-hidden={providerStatus !== "ready"}
        aria-label={locale === "ja" ? "道路地図上の旅程" : "Trip route on a street map"}
        className="planner-openfree-map"
        ref={mapContainerRef}
      />
      <svg
        aria-hidden={providerStatus === "ready"}
        aria-label={locale === "ja" ? "地点と訪問順の概略地図" : "Geographic overview of places and visit order"}
        className="planner-zero-map-fallback"
        onClick={chooseFromMap}
        role={providerStatus === "ready" ? undefined : "img"}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <defs>
          <linearGradient id="zero-map-land" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f5f4ed" />
            <stop offset="0.5" stopColor="#eef2e9" />
            <stop offset="1" stopColor="#f8f6f0" />
          </linearGradient>
          <pattern height="76" id="zero-map-grid" patternUnits="userSpaceOnUse" width="76">
            <path d="M 76 0 L 0 0 0 76" fill="none" stroke="#d7ddd4" strokeOpacity=".34" strokeWidth="1" />
          </pattern>
          <filter id="zero-map-shadow" height="160%" width="160%" x="-30%" y="-30%">
            <feDropShadow dx="0" dy="4" floodColor="#1b2a22" floodOpacity=".18" stdDeviation="6" />
          </filter>
        </defs>
        <rect fill="url(#zero-map-land)" height={HEIGHT} width={WIDTH} />
        <path className="planner-zero-map-water" d="M760 -30 C670 120 720 220 650 340 C590 446 620 560 550 790 L1030 790 L1030 -30 Z" />
        <path className="planner-zero-map-terrain" d="M-70 620 C110 500 170 590 330 460 S610 370 760 210 S990 170 1080 45" />
        <path className="planner-zero-map-terrain is-secondary" d="M-50 290 C130 160 300 330 455 196 S760 130 1050 260" />
        <rect fill="url(#zero-map-grid)" height={HEIGHT} width={WIDTH} />

        {views.flatMap((view) => view.drawableSegments.map((segment, index) => (
          <g className={`planner-zero-route is-measured${view.active ? " is-active" : ""}`} key={`measured-${view.dayIndex}-${index}`}>
            <path className="planner-zero-route-outline" d={pathData(segment, bounds)} />
            <path d={pathData(segment, bounds)} style={{ stroke: view.color }} />
          </g>
        )))}
        {views.flatMap((view) => view.connectorSegments.map((segment, index) => (
          <path
            className={`planner-zero-route is-estimated${view.active ? " is-active" : ""}`}
            d={pathData(segment, bounds)}
            key={`connector-${view.dayIndex}-${index}`}
            style={{ stroke: view.color }}
          />
        )))}

        {views.flatMap((view) => view.stops.map((stop, index) => {
          const point = project(stop, bounds);
          const selected = selectedStopId === stop.id;
          const action = () => onSelectDayStop(view.dayIndex, stop.id);
          return (
            <g
              aria-label={`${stop.name}, ${locale === "ja" ? `${view.dayNumber}日目` : `day ${view.dayNumber}`}`}
              className={`planner-zero-pin is-${stop.kind ?? "anchor"}${selected ? " is-selected" : ""}${view.active ? " is-active-day" : ""}`}
              key={`${view.dayIndex}-${stop.id}-${index}`}
              onClick={(event) => { event.stopPropagation(); action(); }}
              onKeyDown={(event) => keyActivates(event, action)}
              role="button"
              style={{ "--zero-pin-color": view.color } as CSSProperties}
              tabIndex={0}
              transform={`translate(${point.x} ${point.y})`}
            >
              <circle className="planner-zero-pin-halo" r={selected ? 25 : 20} />
              <circle className="planner-zero-pin-dot" r={selected ? 18 : 15} />
              <text className="planner-zero-pin-glyph" textAnchor="middle" y="5">{markerGlyph(stop, index + 1)}</text>
              <text className="planner-zero-pin-label" textAnchor="middle" y="39">{stop.name}</text>
            </g>
          );
        }))}

        {foodPins.map((pin) => {
          const point = project(pin, bounds);
          const selected = selectedFoodPinId === pin.id;
          const action = () => onSelectFood(pin.slotId, pin.candidateId);
          return (
            <g className={`planner-zero-special-pin is-food${selected ? " is-selected" : ""}`} key={pin.id} onClick={(event) => { event.stopPropagation(); action(); }} onKeyDown={(event) => keyActivates(event, action)} role="button" tabIndex={0} transform={`translate(${point.x} ${point.y})`}>
              <circle r={selected ? 20 : 17} /><text textAnchor="middle" y="6">●</text><text className="planner-zero-special-label" textAnchor="middle" y="40">{pin.name}</text>
            </g>
          );
        })}
        {hotelPins.map((pin) => {
          const point = project(pin, bounds);
          const selected = selectedHotelPinId === pin.id;
          const action = () => onSelectHotelCandidate(pin.id);
          return (
            <g className={`planner-zero-special-pin is-hotel${selected ? " is-selected" : ""}`} key={pin.id} onClick={(event) => { event.stopPropagation(); action(); }} onKeyDown={(event) => keyActivates(event, action)} role="button" tabIndex={0} transform={`translate(${point.x} ${point.y})`}>
              <circle r={selected ? 20 : 17} /><text textAnchor="middle" y="5">H</text><text className="planner-zero-special-label" textAnchor="middle" y="40">{pin.name}</text>
            </g>
          );
        })}
        {recommendationPins.map((pin) => {
          const point = project(pin, bounds);
          const selected = selectedRecommendationPinId === pin.id;
          const action = () => onSelectRecommendation(pin.id);
          return (
            <g className={`planner-zero-special-pin is-recommendation${selected ? " is-selected" : ""}`} key={pin.id} onClick={(event) => { event.stopPropagation(); action(); }} onKeyDown={(event) => keyActivates(event, action)} role="button" tabIndex={0} transform={`translate(${point.x} ${point.y})`}>
              <circle r={selected ? 20 : 17} /><text textAnchor="middle" y="5">✦</text><text className="planner-zero-special-label" textAnchor="middle" y="40">{pin.name}</text>
            </g>
          );
        })}
        {validPoint(coordinatePick) ? (() => {
          const point = project(coordinatePick, bounds);
          return <g className="planner-zero-special-pin is-manual" transform={`translate(${point.x} ${point.y})`}><circle r="18" /><text textAnchor="middle" y="6">+</text></g>;
        })() : null}

        <g className="planner-zero-scale" transform={`translate(${WIDTH - EDGE - scaleWidth} ${HEIGHT - 42})`}>
          <path d={`M0 0 H${scaleWidth} M0 -6 V6 M${scaleWidth} -6 V6`} />
          <text textAnchor="middle" x={scaleWidth / 2} y="-12">{scaleKilometres < 1 ? `${Math.round(scaleKilometres * 1000)} m` : `${Number(scaleKilometres.toFixed(1))} km`}</text>
        </g>
      </svg>
      {providerStatus === "failed" ? (
        <button className="planner-zero-map-retry" onClick={() => setProviderAttempt((current) => current + 1)} type="button">
          {locale === "ja" ? "道路地図を再読み込み" : "Reload street map"}
        </button>
      ) : null}
      {coordinatePickActive ? <p className="planner-zero-map-pick-hint">{locale === "ja" ? "地図上で地点を選んでください" : "Choose the point on the map"}</p> : null}
    </div>
  );
}
