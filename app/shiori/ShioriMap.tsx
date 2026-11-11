"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";

import type { ShioriDay, ShioriHotel, ShioriLeg } from "../../lib/shiori/plan";

/*
 * The booklet's map: numbered pins for the day being read, small dots for the
 * other days, and one solid line per leg drawn the way it is travelled — a
 * train leg follows its stations, a walk or a drive follows its streets. Only
 * a leg whose way could not be looked up is a straight line, and that one is
 * dashed so it is never mistaken for a route.
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const DAY_COLORS = ["#2f6fed", "#e0603c", "#12956b", "#8e56d6", "#d19a14", "#d6408f", "#3a8ea0"];

type Props = {
  days: ShioriDay[];
  selectedDay: number;
  hotel: ShioriHotel | null;
  /** Bumped to focus a stop from the timeline. */
  focus: { placeId: string; token: number } | null;
  onSelectStop?: (dayIndex: number, placeId: string) => void;
  label: string;
  /** What each kind of line means; a line with no legend is a riddle. */
  legend: { rail: string; street: string; straight: string };
};

function lineFeatures(days: ShioriDay[], selectedDay: number) {
  return days.flatMap((day) => {
    const legs: ShioriLeg[] = [...(day.fromHotel ? [day.fromHotel] : []), ...day.legs, ...(day.toHotel ? [day.toHotel] : [])];
    // A leg whose way is still being looked up is not drawn yet: a straight
    // line that turns into a street a second later only reads as a mistake.
    return legs.filter((leg) => leg.hasPath || leg.noPath).map((leg) => ({
      type: "Feature" as const,
      properties: {
        // rail: through the stations · street: along the roads · straight: unknown
        kind: leg.mode === "rail" ? "rail" : leg.hasPath ? "street" : "straight",
        color: DAY_COLORS[day.index % DAY_COLORS.length],
        selected: day.index === selectedDay,
      },
      geometry: { type: "LineString" as const, coordinates: leg.path.map((point) => [point.longitude, point.latitude]) },
    }));
  });
}

export default function ShioriMap({ days, selectedDay, hotel, focus, onSelectStop, label, legend }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const library = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onSelect = useRef(onSelectStop);
  useEffect(() => { onSelect.current = onSelectStop; }, [onSelectStop]);
  // The legend names only the lines that are on the map right now.
  const kinds = new Set(lineFeatures(days, selectedDay).filter((feature) => feature.properties.selected).map((feature) => feature.properties.kind));

  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !container.current) return;
      library.current = maplibre;
      const workerUrl = process.env.NEXT_PUBLIC_MAPLIBRE_WORKER_URL;
      if (workerUrl) maplibre.setWorkerUrl(workerUrl);
      const instance = new maplibre.Map({
        container: container.current,
        style: STYLE,
        center: [139.7671, 35.6812],
        zoom: 10,
        attributionControl: { compact: true },
      });
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      instance.on("load", () => {
        if (cancelled) return;
        // On a phone the opened credit line covers a third of the map and the
        // last pin with it. It starts folded behind its (i) button there, as
        // MapLibre itself folds it on the first touch.
        const foldCredit = () => {
          if (!container.current || container.current.clientWidth >= 520) return;
          const credit = container.current.querySelector(".maplibregl-ctrl-attrib");
          credit?.classList.remove("maplibregl-compact-show");
          credit?.removeAttribute("open");
        };
        foldCredit();
        // The credit text can arrive with the first tiles, after "load".
        instance.once("idle", foldCredit);
        instance.addSource("legs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const selected = ["==", ["get", "selected"], true] as unknown as boolean;
        const opacity = ["case", selected, 0.95, 0.35] as unknown as number;
        const color = ["get", "color"] as unknown as string;
        const round = { "line-cap": "round", "line-join": "round" } as const;
        instance.addLayer({
          id: "legs-straight",
          type: "line",
          source: "legs",
          filter: ["==", ["get", "kind"], "straight"],
          paint: { "line-color": "#7b8089", "line-width": ["case", selected, 2.5, 1.5] as unknown as number, "line-opacity": opacity, "line-dasharray": [2, 2] },
        });
        // A white edge keeps the day's line readable over roads and parks.
        instance.addLayer({
          id: "legs-casing",
          type: "line",
          source: "legs",
          filter: ["all", ["!=", ["get", "kind"], "straight"], selected] as unknown as boolean,
          layout: round,
          paint: { "line-color": "#ffffff", "line-width": ["case", ["==", ["get", "kind"], "rail"], 8.5, 7] as unknown as number, "line-opacity": 0.9 },
        });
        instance.addLayer({
          id: "legs-street",
          type: "line",
          source: "legs",
          filter: ["==", ["get", "kind"], "street"],
          layout: round,
          paint: { "line-color": color, "line-width": ["case", selected, 4, 2] as unknown as number, "line-opacity": opacity },
        });
        instance.addLayer({
          id: "legs-rail",
          type: "line",
          source: "legs",
          filter: ["==", ["get", "kind"], "rail"],
          layout: round,
          paint: { "line-color": color, "line-width": ["case", selected, 5.5, 2.5] as unknown as number, "line-opacity": opacity },
        });
        setReady(true);
      });
      instance.on("error", () => { /* A failed tile is not a failed map. */ });
      map.current = instance;
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    const maplibre = library.current;
    if (!ready || !instance || !maplibre) return;
    (instance.getSource("legs") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: lineFeatures(days, selectedDay) });
    for (const marker of markers.current) marker.remove();
    markers.current = [];
    const bounds = new maplibre.LngLatBounds();
    let boundsCount = 0;
    for (const day of days) {
      const isSelected = day.index === selectedDay;
      day.stops.forEach((stop, position) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `shiori-pin${isSelected ? " is-selected" : ""}`;
        element.style.setProperty("--pin", DAY_COLORS[day.index % DAY_COLORS.length]);
        element.textContent = isSelected ? String(position + 1) : "";
        element.title = stop.place.name;
        element.setAttribute("aria-label", stop.place.name);
        element.addEventListener("click", () => onSelect.current?.(day.index, stop.place.id));
        markers.current.push(new maplibre.Marker({ element }).setLngLat([stop.place.lon, stop.place.lat]).addTo(instance));
        if (isSelected) {
          bounds.extend([stop.place.lon, stop.place.lat]);
          boundsCount += 1;
        }
      });
    }
    if (hotel) {
      const element = document.createElement("div");
      element.className = "shiori-pin is-hotel";
      element.textContent = "H";
      element.title = hotel.name;
      markers.current.push(new maplibre.Marker({ element }).setLngLat([hotel.lon, hotel.lat]).addTo(instance));
      bounds.extend([hotel.lon, hotel.lat]);
      boundsCount += 1;
    }
    if (boundsCount === 0) {
      for (const day of days) for (const stop of day.stops) { bounds.extend([stop.place.lon, stop.place.lat]); boundsCount += 1; }
    }
    if (boundsCount === 1) instance.easeTo({ center: bounds.getCenter(), zoom: 14, duration: 500 });
    else if (boundsCount > 1) instance.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 500 });
  }, [days, selectedDay, hotel, ready]);

  useEffect(() => {
    if (!focus || !ready || !map.current) return;
    const stop = days.flatMap((day) => day.stops).find((candidate) => candidate.place.id === focus.placeId);
    if (stop) map.current.easeTo({ center: [stop.place.lon, stop.place.lat], zoom: Math.max(map.current.getZoom(), 14.5), duration: 450 });
    // `days` is read at focus time only; a re-plan must not re-centre the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready]);

  return (
    <div aria-label={label} className="shiori-map" role="region">
      <div className="shiori-map-canvas" ref={container} />
      <ul className="shiori-map-legend">
        {kinds.has("rail") ? <li><i className="is-rail" />{legend.rail}</li> : null}
        {kinds.has("street") ? <li><i className="is-street" />{legend.street}</li> : null}
        {kinds.has("straight") ? <li><i className="is-straight" />{legend.straight}</li> : null}
      </ul>
      {failed ? <p className="shiori-map-note">地図を読み込めませんでした。しおりはそのまま使えます。</p> : null}
    </div>
  );
}
