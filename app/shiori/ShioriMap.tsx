"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";

import type { ShioriDay, ShioriHotel, ShioriLeg, ShioriStop } from "../../lib/shiori/plan";
import { photoUrl } from "../../lib/shiori/state";

/*
 * The booklet's map: numbered pins for the day being read, small dots for the
 * other days, and one solid line per leg drawn the way it is travelled — a
 * train leg follows its stations, a walk or a drive follows its streets. Only
 * a leg whose way could not be looked up is a straight line, and that one is
 * dashed so it is never mistaken for a route.
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
/** 朱・藍・松葉・江戸紫・芥子・臙脂・鉄: each carries white text at AA and reads on the paper card. */
export const DAY_COLORS = ["#b3402a", "#2b4a7a", "#3d6b47", "#6b4a8c", "#8a5f00", "#9b2c52", "#2a6c78"];
const UNKNOWN_WAY = "#6f6a62";
const CARD = "#fdf9ef";

export type ShioriMapText = {
  expand: string;
  collapse: string;
  /** Opens the stop in the booklet. */
  view: string;
  close: string;
  hotel: string;
  /** One or two characters for the hotel's square pin. */
  hotelMark: string;
  failed: string;
  pinLabel: (dayIndex: number, position: number, name: string) => string;
  peekMeta: (stop: ShioriStop) => string;
};

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
  text: ShioriMapText;
};

/**
 * The basemap is OpenFreeMap's own style; only its flat areas are tinted
 * toward the booklet's paper. A layer that is missing or shaped differently
 * is left exactly as it came.
 */
function tintBasemap(instance: MapLibreMap) {
  const tints: Array<[RegExp, "background-color" | "fill-color", string]> = [
    [/^background$/, "background-color", "#efe6d2"],
    [/^water$/, "fill-color", "#b8cfd6"],
    [/^(park|landcover_wood|landcover_grass|landuse_cemetery|landuse_pitch)$/, "fill-color", "#d2dab6"],
    [/^landuse_residential$/, "fill-color", "#ebe1cb"],
  ];
  try {
    for (const layer of instance.getStyle().layers ?? []) {
      const tint = tints.find(([pattern]) => pattern.test(layer.id));
      if (!tint) continue;
      if ((tint[1] === "background-color") !== (layer.type === "background")) continue;
      if (tint[1] === "fill-color" && layer.type !== "fill") continue;
      instance.setPaintProperty(layer.id, tint[1], tint[2]);
    }
  } catch {
    // The untinted basemap is still a correct map.
  }
}

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

/** The stations a train leg passes, as small rings on the day being read. */
function stationFeatures(days: ShioriDay[], selectedDay: number) {
  return days.filter((day) => day.index === selectedDay).flatMap((day) => {
    const legs: ShioriLeg[] = [...(day.fromHotel ? [day.fromHotel] : []), ...day.legs, ...(day.toHotel ? [day.toHotel] : [])];
    return legs.filter((leg) => leg.mode === "rail" && leg.rail).flatMap((leg) => leg.rail!.rides.flatMap((ride) => ride.path.map((point) => ({
      type: "Feature" as const,
      properties: { color: DAY_COLORS[day.index % DAY_COLORS.length] },
      geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] },
    }))));
  });
}

export default function ShioriMap({ days, selectedDay, hotel, focus, onSelectStop, label, legend, text }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const library = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The stop whose card is shown: the latest of a pin tapped here and a stop
  // tapped in the booklet, until it is closed.
  const [picked, setPicked] = useState<{ placeId: string; token: number } | null>(null);
  const [closedToken, setClosedToken] = useState(0);
  const latest = picked && (!focus || picked.token >= focus.token) ? picked : focus;
  const peek = (() => {
    if (!latest || latest.token === closedToken) return null;
    for (const day of days) {
      const position = day.stops.findIndex((stop) => stop.place.id === latest.placeId);
      if (position >= 0) return { day, position, stop: day.stops[position] };
    }
    return null;
  })();
  const peekId = peek?.stop.place.id ?? null;
  const peekShown = useRef(false);
  useEffect(() => { peekShown.current = peekId !== null; }, [peekId]);
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
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
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
        tintBasemap(instance);
        // The credit text can arrive with the first tiles, after "load".
        instance.once("idle", foldCredit);
        instance.addSource("legs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        instance.addSource("stations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const selected = ["==", ["get", "selected"], true] as unknown as boolean;
        const opacity = ["case", selected, 0.95, 0.35] as unknown as number;
        const color = ["get", "color"] as unknown as string;
        const round = { "line-cap": "round", "line-join": "round" } as const;
        instance.addLayer({
          id: "legs-straight",
          type: "line",
          source: "legs",
          filter: ["==", ["get", "kind"], "straight"],
          paint: { "line-color": UNKNOWN_WAY, "line-width": ["case", selected, 2.5, 1.5] as unknown as number, "line-opacity": opacity, "line-dasharray": [2, 2] },
        });
        // A paper-coloured edge keeps the day's line readable over roads and parks.
        instance.addLayer({
          id: "legs-casing",
          type: "line",
          source: "legs",
          filter: ["all", ["!=", ["get", "kind"], "straight"], selected] as unknown as boolean,
          layout: round,
          paint: { "line-color": CARD, "line-width": ["case", ["==", ["get", "kind"], "rail"], 8.5, 7] as unknown as number, "line-opacity": 0.9 },
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
        instance.addLayer({
          id: "legs-stations",
          type: "circle",
          source: "stations",
          minzoom: 11,
          paint: { "circle-radius": 3, "circle-color": CARD, "circle-stroke-color": color, "circle-stroke-width": 2 },
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
    (instance.getSource("stations") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: stationFeatures(days, selectedDay) });
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
        element.dataset.place = stop.place.id;
        element.setAttribute("aria-label", text.pinLabel(day.index, position, stop.place.name));
        element.addEventListener("click", () => setPicked({ placeId: stop.place.id, token: Date.now() }));
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
      element.textContent = text.hotelMark;
      element.title = hotel.name;
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", hotel.name);
      markers.current.push(new maplibre.Marker({ element }).setLngLat([hotel.lon, hotel.lat]).addTo(instance));
      bounds.extend([hotel.lon, hotel.lat]);
      boundsCount += 1;
    }
    if (boundsCount === 0) {
      for (const day of days) for (const stop of day.stops) { bounds.extend([stop.place.lon, stop.place.lat]); boundsCount += 1; }
    }
    if (boundsCount === 1) instance.easeTo({ center: bounds.getCenter(), zoom: 14, duration: 500 });
    else if (boundsCount > 1) instance.fitBounds(bounds, { padding: { top: 40, right: 40, left: 40, bottom: peekShown.current ? 132 : 40 }, maxZoom: 15, duration: 500 });
    // The pin texts are rebuilt with the days; the wording itself does not change between plans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, selectedDay, hotel, ready]);

  // The stop whose card is open is the larger, ringed pin.
  useEffect(() => {
    for (const marker of markers.current) {
      const element = marker.getElement();
      element.classList.toggle("is-focus", peekId !== null && element.dataset.place === peekId);
    }
  }, [peekId, days, selectedDay, hotel, ready]);

  useEffect(() => {
    if (!focus || !ready || !map.current) return;
    const stop = days.flatMap((day) => day.stops).find((candidate) => candidate.place.id === focus.placeId);
    if (stop) map.current.easeTo({ center: [stop.place.lon, stop.place.lat], zoom: Math.max(map.current.getZoom(), 14.5), duration: 450, offset: [0, -Math.min(60, Math.round((container.current?.clientHeight ?? 180) * 0.3))] });
    // The pin sits above the middle, clear of its card. `days` is read at focus
    // time only; a re-plan must not re-centre the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready]);

  // The canvas follows the frame once it has finished opening or folding.
  useEffect(() => {
    const handle = window.setTimeout(() => map.current?.resize(), 260);
    return () => window.clearTimeout(handle);
  }, [expanded]);

  const peekPhoto = peek ? photoUrl(peek.stop.place.img, 160) : null;
  return (
    <div aria-label={label} className={`shiori-map${expanded ? " is-expanded" : ""}`} role="region">
      <div className="shiori-map-frame" id="shiori-map-frame" onTransitionEnd={(event) => { if (event.propertyName === "height") map.current?.resize(); }}>
        <div className="shiori-map-canvas" ref={container} />
        <span aria-hidden="true" className="shiori-map-creases" />
        <span aria-hidden="true" className="shiori-map-compass">N</span>
        {peek ? (
          <div
            className="shiori-peek"
            onKeyDown={(event) => { if (event.key === "Escape") setClosedToken(latest?.token ?? 0); }}
            style={{ ["--day" as string]: DAY_COLORS[peek.day.index % DAY_COLORS.length] }}
          >
            {peekPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" className="shiori-peek-photo" decoding="async" height={40} key={peekPhoto} loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} src={peekPhoto} width={40} />
            ) : null}
            <div className="shiori-peek-text">
              <b><i>{peek.position + 1}</i>{peek.stop.place.name}</b>
              <small>{text.peekMeta(peek.stop)}</small>
            </div>
            <button className="shiori-peek-view" onClick={() => onSelect.current?.(peek.day.index, peek.stop.place.id)} type="button">{text.view}</button>
            <button aria-label={text.close} className="shiori-peek-close" onClick={() => setClosedToken(latest?.token ?? 0)} type="button">×</button>
          </div>
        ) : null}
        {failed ? <p className="shiori-map-note">{text.failed}</p> : null}
      </div>
      <div className="shiori-map-foot">
        <ul className="shiori-map-legend">
          {kinds.has("rail") ? <li><i className="is-rail" />{legend.rail}</li> : null}
          {kinds.has("street") ? <li><i className="is-street" />{legend.street}</li> : null}
          {kinds.has("straight") ? <li><i className="is-straight" />{legend.straight}</li> : null}
          {hotel ? <li><i aria-hidden="true" className="is-hotel">{text.hotelMark}</i>{text.hotel}</li> : null}
        </ul>
        <button aria-controls="shiori-map-frame" aria-expanded={expanded} className="shiori-map-toggle" onClick={() => setExpanded((value) => !value)} type="button">
          {expanded ? text.collapse : text.expand}
        </button>
      </div>
    </div>
  );
}
