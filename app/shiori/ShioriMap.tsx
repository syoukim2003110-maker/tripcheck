"use client";

import { useEffect, useRef, useState } from "react";

import { appleRelayUrl } from "../../lib/apple-relay-client";
import { loadMapKit, mapToken, onMapKitState, type MapKit, type MapKitAnnotation, type MapKitEvent, type MapKitMap, type MapKitOverlay } from "../../lib/mapkit-loader";
import type { ShioriDay, ShioriHotel, ShioriLeg, ShioriStop } from "../../lib/shiori/plan";
import { photoUrl } from "../../lib/shiori/state";

/*
 * The itinerary's map: an Apple map (MapKit JS) with numbered pins for the
 * day being read, small dots for the other days, and one solid line per leg
 * drawn the way it is travelled — a train leg follows its stations, a walk or
 * a drive follows its streets. Only a leg whose way could not be looked up is
 * a straight line, and that one is dashed so it is never mistaken for a route.
 *
 * The map is Apple's, so Apple's walking and driving answers may be drawn on
 * it (Apple's terms allow Apple map data on an Apple map only). The train
 * lines and stations are TripCheck's own (Wikidata), and so are the street
 * lines the OpenStreetMap router drew; both are laid over the Apple map and
 * credited beside it. Apple's logo and legal link, drawn by
 * MapKit JS inside the frame, are never covered.
 */

/** One theme blue; size, numbering and opacity distinguish the active day. */
export const DAY_COLORS = ["#1967D2"];
const UNKNOWN_WAY = "#6b7280";
const CARD = "#ffffff";
/** Roughly zoom 15 and zoom 11 on a phone-sized frame: closer than the first is too close; wider than the second hides the station rings. */
const CLOSEST_SPAN = 0.008;
const STATIONS_WITHIN_SPAN = 0.25;


export type ShioriMapText = {
  expand: string;
  collapse: string;
  /** Opens the stop in the itinerary. */
  view: string;
  close: string;
  hotel: string;
  /** One or two characters for the hotel's square pin. */
  hotelMark: string;
  failed: string;
  /** The credits for TripCheck's own lines on the Apple map: rail from Wikidata, street routes from OpenStreetMap. */
  railCredit: string;
  streetCredit: string;
  pinLabel: (dayIndex: number, position: number, name: string) => string;
  peekMeta: (stop: ShioriStop) => string;
  /** "約12分" for the tag on a leg, and what each way of travelling is called. */
  legTag: (minutes: number) => string;
  modes: Record<ShioriLeg["mode"], string>;
};

/*
 * A number says the order but not what a place is, and a line says where but
 * not how. A restaurant, a café and the hotel carry their own mark, and each
 * leg of the day being read wears a small tag — train, on foot, taxi — with
 * its minutes, so a long line across the map reads as "a train, 12 minutes"
 * and not as a long walk.
 */
const MAP_ICONS = {
  meal: "M7 3v7a2 2 0 0 0 2 2v9M11 3v7M9 3v7M16 3c-1.5 2-2 4-2 7h2v11",
  cup: "M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9ZM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2M4 21h13",
  bed: "M4 18v-9M4 13h16v5M20 13v-1a3 3 0 0 0-3-3h-6v4M7.5 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  walk: "M13 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 9l3-1.5 2.5 2.5 2.5 1M12 7.5 11 13l2.5 3 .5 5M11 13l-2 3-2.5 4",
  rail: "M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM5 11h14M8.5 14.5h.01M15.5 14.5h.01M8 17l-2 3M16 17l2 3",
  transit: "M6 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM5 12h14M8 15h.01M16 15h.01M7 17v2M17 17v2",
  taxi: "M5 16v-3l1.5-4h11L19 13v3M5 16h14M5 16v2M19 16v2M7.5 13.5h.01M16.5 13.5h.01M10 9V7h4v2",
} as const;

function mapIcon(name: keyof typeof MAP_ICONS, size: number) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: String(size), height: String(size), fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", MAP_ICONS[name]);
  svg.appendChild(path);
  return svg;
}

/** What a stop is, when a mark says it better than a number. */
function stopMark(stop: ShioriStop): "meal" | "cup" | null {
  if (stop.place.meal) return "meal";
  return /cafe|bakery/.test(stop.place.kind ?? "") ? "cup" : null;
}

/** The point halfway along a leg's drawn path, by distance. */
function midpoint(path: ShioriLeg["path"]): [number, number] | null {
  if (path.length === 0) return null;
  const lengths = path.slice(1).map((point, index) => Math.hypot(point.latitude - path[index].latitude, (point.longitude - path[index].longitude) * Math.cos(point.latitude * Math.PI / 180)));
  let half = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    if (half <= lengths[index] && lengths[index] > 0) {
      const share = half / lengths[index];
      return [path[index].longitude + (path[index + 1].longitude - path[index].longitude) * share, path[index].latitude + (path[index + 1].latitude - path[index].latitude) * share];
    }
    half -= lengths[index];
  }
  return [path[0].longitude, path[0].latitude];
}

type Props = {
  days: ShioriDay[];
  selectedDay: number;
  hotel: ShioriHotel | null;
  /** The stop that is open in the itinerary; a new token re-centres the map on it. */
  focus: { placeId: string; token: number } | null;
  onSelectStop?: (dayIndex: number, placeId: string) => void;
  /** Told when the Apple map is shown, or could not be. Apple's routes are asked for only while it is shown. */
  onMapState?: (state: "ready" | "failed") => void;
  locale: "ja" | "en";
  label: string;
  /** What each kind of line means; a line with no legend is a riddle. */
  legend: { rail: string; street: string; straight: string };
  text: ShioriMapText;
};

type LineKind = "rail" | "street" | "straight";
type Line = { kind: LineKind; hotel: boolean; color: string; points: Array<{ latitude: number; longitude: number }> };

/*
 * Only the day being read draws its route: every day's lines at once crossed
 * into a tangle no one could follow, while the other days' places stay as
 * small dots. The way to and from the hotel is drawn thin and light — it is
 * the same each day and it is not where the day's sights are.
 */
function dayLines(days: ShioriDay[], selectedDay: number): Line[] {
  return days.filter((day) => day.index === selectedDay).flatMap((day) => {
    const legs: Array<ShioriLeg & { hotelLeg?: boolean }> = [
      ...(day.fromHotel ? [{ ...day.fromHotel, hotelLeg: true }] : []),
      ...day.legs,
      ...(day.toHotel ? [{ ...day.toHotel, hotelLeg: true }] : []),
    ];
    // A leg whose way is still being looked up is not drawn yet: a straight
    // line that turns into a street a second later only reads as a mistake.
    return legs.filter((leg) => (leg.hasPath || leg.noPath) && leg.path.length > 1).map((leg) => ({
      hotel: Boolean(leg.hotelLeg),
      // rail: through the stations · street: along the roads · straight: unknown
      kind: leg.mode === "rail" ? "rail" as const : leg.hasPath ? "street" as const : "straight" as const,
      color: DAY_COLORS[day.index % DAY_COLORS.length],
      points: leg.path,
    }));
  });
}

/** The stations a train leg is boarded and left at, as small rings on the day being read. */
function dayStations(days: ShioriDay[], selectedDay: number) {
  return days.filter((day) => day.index === selectedDay).flatMap((day) => {
    const legs: ShioriLeg[] = [...(day.fromHotel ? [day.fromHotel] : []), ...day.legs, ...(day.toHotel ? [day.toHotel] : [])];
    // Only where one boards and gets off: a ring at every stop passed made the line look like beads.
    return legs.filter((leg) => leg.mode === "rail" && leg.rail).flatMap((leg) => leg.rail!.rides.flatMap((ride) => (ride.path.length > 1 ? [ride.path[0], ride.path[ride.path.length - 1]] : ride.path)));
  });
}

/** The overlays for the lines, bottom first: the dashed unknown ways, the white edges, then the streets and the rails. */
function lineOverlays(mapkit: MapKit, lines: Line[]): MapKitOverlay[] {
  const coordinates = (line: Line) => line.points.map((point) => new mapkit.Coordinate(point.latitude, point.longitude));
  const style = (options: Record<string, unknown>) => new mapkit.Style({ lineCap: "round", lineJoin: "round", ...options });
  const overlay = (line: Line, options: Record<string, unknown>) => new mapkit.PolylineOverlay(coordinates(line), { style: style(options), enabled: false });
  return [
    ...lines.filter((line) => line.kind === "straight").map((line) => overlay(line, { strokeColor: UNKNOWN_WAY, strokeOpacity: line.hotel ? 0.45 : 0.95, lineWidth: 2.5, lineDash: [5, 5], lineCap: "butt" })),
    // A white edge keeps the day's line readable over roads and parks.
    ...lines.filter((line) => line.kind !== "straight" && !line.hotel).map((line) => overlay(line, { strokeColor: CARD, strokeOpacity: 0.9, lineWidth: line.kind === "rail" ? 8.5 : 7 })),
    ...lines.filter((line) => line.kind === "street").map((line) => overlay(line, { strokeColor: line.color, strokeOpacity: line.hotel ? 0.45 : 0.95, lineWidth: line.hotel ? 2.5 : 4 })),
    ...lines.filter((line) => line.kind === "rail").map((line) => overlay(line, { strokeColor: line.color, strokeOpacity: line.hotel ? 0.45 : 0.95, lineWidth: line.hotel ? 3 : 5.5 })),
  ];
}

function prefersLessMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export default function ShioriMap({ days, selectedDay, hotel, focus, onSelectStop, onMapState, locale, label, legend, text }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapKitMap | null>(null);
  const library = useRef<MapKit | null>(null);
  const pinElements = useRef<HTMLElement[]>([]);
  const tagElements = useRef<HTMLElement[]>([]);
  const stationAnnotations = useRef<MapKitAnnotation[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The pin that was tapped. Its card is shown until it is closed or another
  // day is opened. A stop opened
  // in the itinerary is only ringed on the map: its card would say what the
  // reader is already looking at.
  const [picked, setPicked] = useState<string | null>(null);
  const [shownDay, setShownDay] = useState(selectedDay);
  if (shownDay !== selectedDay) {
    setShownDay(selectedDay);
    setPicked(null);
  }
  const peek = (() => {
    if (!picked || shownDay !== selectedDay) return null;
    for (const day of days) {
      const position = day.stops.findIndex((stop) => stop.place.id === picked);
      if (position >= 0) return { day, position, stop: day.stops[position] };
    }
    return null;
  })();
  const peekId = peek?.stop.place.id ?? null;
  const ringId = peekId ?? focus?.placeId ?? null;
  const peekShown = useRef(false);
  useEffect(() => { peekShown.current = peekId !== null; }, [peekId]);
  const slot = useRef<HTMLDivElement | null>(null);
  const viewButton = useRef<HTMLButtonElement | null>(null);
  // A pin opened from the keyboard hands the focus to its card.
  const byKeyboard = useRef(false);
  useEffect(() => {
    if (peekId && byKeyboard.current) viewButton.current?.focus();
    byKeyboard.current = false;
  }, [peekId]);
  const closePeek = () => {
    // Focus that was in the card goes back to its pin, not to the top of the page.
    const pin = peekId && slot.current?.contains(document.activeElement)
      ? pinElements.current.find((element) => element.dataset.place === peekId)
      : null;
    setPicked(null);
    pin?.focus();
  };
  const onSelect = useRef(onSelectStop);
  useEffect(() => { onSelect.current = onSelectStop; }, [onSelectStop]);
  const onState = useRef(onMapState);
  useEffect(() => { onState.current = onMapState; }, [onMapState]);
  // The legend names only the lines that are on the map right now.
  const kinds = new Set(dayLines(days, selectedDay).map((line) => line.kind));

  useEffect(() => {
    let cancelled = false;
    let instance: MapKitMap | null = null;
    let stopListening = () => {};
    const fail = () => {
      if (cancelled) return;
      setFailed(true);
      onState.current?.("failed");
    };
    // The booklet is read first; Apple's script follows once the page is idle.
    const start = () => {
      if (cancelled || !container.current) return;
      if (!appleRelayUrl()) { fail(); return; }
      // Asked for before the script, so a relay that cannot sign fails here rather than as an empty grey frame.
      void mapToken().then(() => loadMapKit(locale)).then((mapkit) => {
        if (cancelled || !container.current) return;
        library.current = mapkit;
        instance = new mapkit.Map(container.current, {
          // A quiet map, so the day's line and pins are the loudest things on it.
          mapType: "mutedStandard",
          colorScheme: "light",
          // Apple's own places would read as stops of the trip.
          pointOfInterestFilter: mapkit.PointOfInterestFilter.excludingAllCategories,
          // North stays up: nothing on the page says which way a turned map faces.
          isRotationEnabled: false,
          showsCompass: mapkit.FeatureVisibility.Hidden,
          showsMapTypeControl: false,
          showsUserLocationControl: false,
          showsZoomControl: true,
          showsScale: mapkit.FeatureVisibility.Hidden,
          center: new mapkit.Coordinate(35.6812, 139.7671),
        });
        // A tapped pin is told through the map as well as through the button's own click.
        instance.addEventListener("select", (event: MapKitEvent) => {
          const place = event.annotation?.data?.place;
          if (typeof place === "string") setPicked(place);
          window.setTimeout(() => { if (instance) instance.selectedAnnotation = null; }, 0);
        });
        map.current = instance;
        // A map made a moment ago ignores a region set in the same moment, so
        // the pins and lines wait for its first frame.
        const firstFrame = new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
        stopListening = onMapKitState((state) => {
          if (cancelled) return;
          if (state === "ready") void firstFrame.then(() => { if (!cancelled) { setFailed(false); setReady(true); onState.current?.("ready"); } });
          if (state === "failed") fail();
        });
      }).catch(fail);
    };
    const idle = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(start, { timeout: 1_500 })
      : window.setTimeout(start, 300);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
      window.clearTimeout(idle);
      stopListening();
      instance?.destroy();
      map.current = null;
      setReady(false);
    };
    // The language is fixed for the page: each language has its own address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    const mapkit = library.current;
    if (!ready || !instance || !mapkit) return;
    instance.removeOverlays(instance.overlays);
    instance.removeAnnotations(instance.annotations);
    const coordinate = (latitude: number, longitude: number) => new mapkit.Coordinate(latitude, longitude);
    // Each element is drawn centred on its point: MapKit anchors at the bottom
    // centre, and a positive offset lifts the element (seen on screen), so it is moved down by half.
    const centred = (height: number) => ({ anchorOffset: new DOMPoint(0, -height / 2), calloutEnabled: false, collisionMode: "circle" });
    const lines = lineOverlays(mapkit, dayLines(days, selectedDay));
    instance.addOverlays(lines);

    const stations = dayStations(days, selectedDay).map((point) => {
      const element = document.createElement("div");
      element.className = "shiori-station";
      element.style.setProperty("--pin", DAY_COLORS[selectedDay % DAY_COLORS.length]);
      return new mapkit.Annotation(coordinate(point.latitude, point.longitude), () => element, { ...centred(10), enabled: false, displayPriority: 1000 });
    });
    stationAnnotations.current = stations;

    // How each leg of the day being read is travelled, said on the line itself.
    // The hotel legs carry no tag: their minutes are in the list, and their
    // tags piled up where the two hotel lines meet.
    const today = days.find((day) => day.index === selectedDay);
    const tags: HTMLElement[] = [];
    const tagAnnotations: MapKitAnnotation[] = [];
    for (const leg of today ? today.legs : []) {
      // A few minutes on foot between neighbours needs no tag; it would only hide the pins.
      if (leg.mode === "walk" && leg.minutes < 5) continue;
      const at = midpoint(leg.path);
      if (!at) continue;
      const element = document.createElement("div");
      element.className = `shiori-legtag is-${leg.mode}`;
      element.style.setProperty("--pin", DAY_COLORS[today!.index % DAY_COLORS.length]);
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `${text.modes[leg.mode]} ${text.legTag(leg.minutes)}`);
      element.appendChild(mapIcon(leg.mode, 14));
      const minutes = document.createElement("span");
      minutes.textContent = text.legTag(leg.minutes);
      element.appendChild(minutes);
      tagAnnotations.push(new mapkit.Annotation(coordinate(at[1], at[0]), () => element, { ...centred(22), enabled: false, displayPriority: 1000 }));
      tags.push(element);
    }
    tagElements.current = tags;

    const pins: HTMLElement[] = [];
    const others: MapKitAnnotation[] = [];
    const todays: MapKitAnnotation[] = [];
    for (const day of days) {
      const isSelected = day.index === selectedDay;
      day.stops.forEach((stop, position) => {
        // A fixed 44px square holds the pin, so the tap target and the anchor
        // stay put while the pin itself grows when it is ringed.
        const holder = document.createElement("div");
        holder.className = "shiori-pin-holder";
        const element = document.createElement("button");
        element.type = "button";
        element.className = `shiori-pin${isSelected ? " is-selected" : ""}`;
        element.style.setProperty("--pin", DAY_COLORS[day.index % DAY_COLORS.length]);
        const mark = isSelected ? stopMark(stop) : null;
        if (mark) {
          // What it is, large; where it comes in the day, as a small badge.
          element.classList.add("has-mark");
          element.appendChild(mapIcon(mark, 17));
          const order = document.createElement("span");
          order.className = "shiori-pin-order";
          order.textContent = String(position + 1);
          element.appendChild(order);
        } else {
          element.textContent = isSelected ? String(position + 1) : "";
        }
        element.title = stop.place.name;
        element.dataset.place = stop.place.id;
        element.setAttribute("aria-label", text.pinLabel(day.index, position, stop.place.name));
        // Only the day being read is in the tab order; the other days' dots still take a tap.
        if (!isSelected) element.tabIndex = -1;
        element.addEventListener("click", (event) => {
          byKeyboard.current = event.detail === 0;
          setPicked(stop.place.id);
        });
        holder.appendChild(element);
        pins.push(element);
        const annotation = new mapkit.Annotation(coordinate(stop.place.lat, stop.place.lon), () => holder, {
          ...centred(44),
          title: stop.place.name,
          accessibilityLabel: text.pinLabel(day.index, position, stop.place.name),
          data: { place: stop.place.id },
          displayPriority: 1000,
        });
        (isSelected ? todays : others).push(annotation);
      });
    }
    let hotelAnnotation: MapKitAnnotation | null = null;
    if (hotel) {
      const holder = document.createElement("div");
      holder.className = "shiori-pin-holder";
      const element = document.createElement("div");
      element.className = "shiori-pin is-hotel has-mark";
      element.appendChild(mapIcon("bed", 17));
      element.title = hotel.name;
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", hotel.name);
      holder.appendChild(element);
      pins.push(element);
      hotelAnnotation = new mapkit.Annotation(coordinate(hotel.lat, hotel.lon), () => holder, { ...centred(44), enabled: false, displayPriority: 1000 });
    }
    pinElements.current = pins;
    // Later is higher: rings and tags under the pins, the other days' dots under the day being read.
    instance.addAnnotations([...stations, ...tagAnnotations, ...others, ...(hotelAnnotation ? [hotelAnnotation] : []), ...todays]);

    // The day being read and the hotel fill the frame; with no day, every stop does.
    const framed = [
      ...(days.find((day) => day.index === selectedDay)?.stops ?? []).map((stop) => ({ latitude: stop.place.lat, longitude: stop.place.lon })),
      ...(hotel ? [{ latitude: hotel.lat, longitude: hotel.lon }] : []),
    ];
    const points = framed.length > 0 ? framed : days.flatMap((day) => day.stops).map((stop) => ({ latitude: stop.place.lat, longitude: stop.place.lon }));
    if (points.length > 0) {
      // Only the wide layout lays the card over the map; there the pins are kept below it.
      // The bottom edge keeps clear of Apple's logo and legal link.
      const height = container.current?.clientHeight ?? 0;
      const width = container.current?.clientWidth ?? 0;
      const top = peekShown.current && height >= 420 ? 110 : 44;
      const [bottom, side] = [56, 44];
      const latitudes = points.map((point) => point.latitude);
      const longitudes = points.map((point) => point.longitude);
      const [south, north, west, east] = [Math.min(...latitudes), Math.max(...latitudes), Math.min(...longitudes), Math.max(...longitudes)];
      // The region is the whole frame, so the margins are paid for by widening it.
      const share = (inner: number, whole: number) => (whole > 0 ? Math.max(0.3, (whole - inner) / whole) : 0.7);
      const latitudeSpan = Math.max(north - south, CLOSEST_SPAN) / share(top + bottom, height);
      const longitudeSpan = Math.max(east - west, CLOSEST_SPAN) / share(side * 2, width);
      // The middle of the region moves down by half of what the top margin takes beyond the bottom one.
      const middle = (north + south) / 2 + latitudeSpan * ((top - bottom) / 2) / Math.max(height, 1);
      const span = new mapkit.CoordinateSpan(latitudeSpan, longitudeSpan);
      instance.setRegionAnimated(new mapkit.CoordinateRegion(coordinate(middle, (east + west) / 2), span), !prefersLessMotion());
    }
    // The pin texts are rebuilt with the days; the wording itself does not change between plans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, selectedDay, hotel, ready]);

  // A tag that would cover a pin or another tag is hidden until zooming in
  // makes room: two labels on top of each other read as neither. The station
  // rings show only once the map is close enough for them to mean something.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const declutter = () => {
      const near = instance.region.span.latitudeDelta <= STATIONS_WITHIN_SPAN;
      for (const station of stationAnnotations.current) station.visible = near;
      // A pin or tag MapKit has not laid out yet has no size, and hides nothing.
      const pins = pinElements.current.filter((element) => element.classList.contains("is-selected") || element.classList.contains("is-hotel")).map((element) => element.getBoundingClientRect()).filter((box) => box.width > 0);
      const shown: DOMRect[] = [];
      for (const tag of tagElements.current) {
        tag.style.visibility = "visible";
        const box = tag.getBoundingClientRect();
        if (box.width === 0) continue;
        const hit = (other: DOMRect) => box.left < other.right + 2 && box.right > other.left - 2 && box.top < other.bottom + 2 && box.bottom > other.top - 2;
        if (pins.some(hit) || shown.some(hit)) tag.style.visibility = "hidden";
        else shown.push(box);
      }
    };
    // MapKit places its annotations a moment after the map stops moving.
    let later = 0;
    const soon = () => { window.clearTimeout(later); later = window.setTimeout(declutter, 120); };
    soon();
    instance.addEventListener("region-change-end", soon);
    window.addEventListener("resize", soon);
    return () => { window.clearTimeout(later); instance.removeEventListener("region-change-end", soon); window.removeEventListener("resize", soon); };
  }, [days, selectedDay, hotel, ready]);

  // The stop whose card is open, or that is open in the itinerary, is the larger, ringed pin.
  useEffect(() => {
    for (const element of pinElements.current) {
      element.classList.toggle("is-focus", ringId !== null && element.dataset.place === ringId);
    }
  }, [ringId, days, selectedDay, hotel, ready]);

  useEffect(() => {
    const instance = map.current;
    const mapkit = library.current;
    if (!focus || !ready || !instance || !mapkit) return;
    const stop = days.flatMap((day) => day.stops).find((candidate) => candidate.place.id === focus.placeId);
    if (!stop) return;
    const at = new mapkit.Coordinate(stop.place.lat, stop.place.lon);
    const animate = !prefersLessMotion();
    // Closer only when the map is wider than a few streets; never further out.
    if (instance.region.span.latitudeDelta > 0.02) instance.setRegionAnimated(new mapkit.CoordinateRegion(at, new mapkit.CoordinateSpan(0.012, 0.012)), animate);
    else instance.setCenterAnimated(at, animate);
    // `days` is read at focus time only; a re-plan must not re-centre the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready]);

  const peekPhoto = peek ? photoUrl(peek.stop.place.img, 160) : null;
  return (
    <div
      aria-label={label}
      className={`shiori-map${expanded ? " is-expanded" : ""}`}
      onKeyDown={(event) => { if (event.key === "Escape" && peek) closePeek(); }}
      role="region"
    >
      <div className="shiori-map-stage">
        <div className="shiori-map-frame" id="shiori-map-frame">
          <div className="shiori-map-canvas" ref={container} />
          <span aria-hidden="true" className="shiori-map-creases" />
          {failed ? <p className="shiori-map-note">{text.failed}</p> : null}
        </div>
        {/* Always on the page, so a screen reader hears the card when a pin fills it. */}
        <div className="shiori-peek-slot" ref={slot} role="status">
          {peek ? (
            <div className="shiori-peek" style={{ ["--day" as string]: DAY_COLORS[peek.day.index % DAY_COLORS.length] }}>
              {peekPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="shiori-peek-photo" decoding="async" height={40} key={peekPhoto} loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} src={peekPhoto} width={40} />
              ) : null}
              <div className="shiori-peek-text">
                <b><i>{peek.position + 1}</i>{peek.stop.place.name}</b>
                <small>{text.peekMeta(peek.stop)}</small>
              </div>
              <button
                className="shiori-peek-view"
                onClick={() => { setPicked(null); onSelect.current?.(peek.day.index, peek.stop.place.id); }}
                ref={viewButton}
                type="button"
              >
                {text.view}
              </button>
              <button aria-label={text.close} className="shiori-peek-close" onClick={closePeek} type="button">×</button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shiori-map-foot">
        <ul className="shiori-map-legend">
          {kinds.has("rail") ? <li><i className="is-rail" />{legend.rail}</li> : null}
          {kinds.has("street") ? <li><i className="is-street" />{legend.street}</li> : null}
          {kinds.has("straight") ? <li><i className="is-straight" />{legend.straight}</li> : null}
          {hotel ? <li><i aria-hidden="true" className="is-hotel"><svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12"><path d={MAP_ICONS.bed} /></svg></i>{text.hotel}</li> : null}
        </ul>
        <button aria-controls="shiori-map-frame" aria-expanded={expanded} className="shiori-map-toggle" onClick={() => setExpanded((value) => !value)} type="button">
          {expanded ? text.collapse : text.expand}
        </button>
      </div>
      {/* TripCheck's own lines on Apple's map, credited to their sources; Apple's own logo and legal link stay inside the frame. */}
      {failed ? null : <p className="shiori-map-credit">{text.railCredit}{locale === "ja" ? " ・ " : " · "}<a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">{text.streetCredit}</a></p>}
    </div>
  );
}

/** A place in a list of search results, as its numbered pin on the small map beside the list. */
export type CandidatePoint = { id: string; name: string; lat: number; lon: number };

/**
 * The small Apple map shown with a list of places found through Apple (a
 * search by name, a pasted list, a meal, a coffee break, a hotel): Apple's
 * terms let what Apple says about places be shown only with the Apple map
 * it belongs to. Each place is a numbered pin; the list beside it carries
 * the same numbers. `onState` hears whether the map could be shown — a list
 * of Apple's places is not shown without it.
 */
export function CandidateMap({ points, locale, label, failed: failedText, onState }: {
  points: readonly CandidatePoint[];
  locale: "ja" | "en";
  label: string;
  failed: string;
  onState?: (state: "ready" | "failed") => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapKitMap | null>(null);
  const library = useRef<MapKit | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onStateRef = useRef(onState);
  useEffect(() => { onStateRef.current = onState; }, [onState]);
  useEffect(() => {
    let cancelled = false;
    let instance: MapKitMap | null = null;
    let stopListening = () => {};
    const fail = () => {
      if (cancelled) return;
      setFailed(true);
      onStateRef.current?.("failed");
    };
    if (!appleRelayUrl()) { fail(); return; }
    void mapToken().then(() => loadMapKit(locale)).then((mapkit) => {
      if (cancelled || !container.current) return;
      library.current = mapkit;
      instance = new mapkit.Map(container.current, {
        mapType: "mutedStandard",
        colorScheme: "light",
        pointOfInterestFilter: mapkit.PointOfInterestFilter.excludingAllCategories,
        isRotationEnabled: false,
        showsCompass: mapkit.FeatureVisibility.Hidden,
        showsMapTypeControl: false,
        showsUserLocationControl: false,
        showsZoomControl: true,
        showsScale: mapkit.FeatureVisibility.Hidden,
        center: new mapkit.Coordinate(35.6812, 139.7671),
      });
      map.current = instance;
      const firstFrame = new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      stopListening = onMapKitState((state) => {
        if (cancelled) return;
        if (state === "ready") void firstFrame.then(() => { if (!cancelled) { setFailed(false); setReady(true); onStateRef.current?.("ready"); } });
        if (state === "failed") fail();
      });
    }).catch(fail);
    return () => {
      cancelled = true;
      stopListening();
      instance?.destroy();
      map.current = null;
      setReady(false);
    };
    // The language is fixed for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const key = points.map((point) => `${point.id}@${point.lat},${point.lon}`).join("|");
  useEffect(() => {
    const instance = map.current;
    const mapkit = library.current;
    if (!ready || !instance || !mapkit) return;
    instance.removeAnnotations(instance.annotations);
    if (points.length === 0) return;
    const annotations = points.map((point, index) => {
      const holder = document.createElement("div");
      holder.className = "shiori-pin-holder";
      const element = document.createElement("div");
      element.className = "shiori-pin is-selected is-candidate";
      element.textContent = String(index + 1);
      element.title = point.name;
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `${index + 1} ${point.name}`);
      holder.appendChild(element);
      return new mapkit.Annotation(new mapkit.Coordinate(point.lat, point.lon), () => holder, { anchorOffset: new DOMPoint(0, -22), calloutEnabled: false, enabled: false, title: point.name, displayPriority: 1000 });
    });
    instance.addAnnotations(annotations);
    const latitudes = points.map((point) => point.lat);
    const longitudes = points.map((point) => point.lon);
    const [south, north, west, east] = [Math.min(...latitudes), Math.max(...latitudes), Math.min(...longitudes), Math.max(...longitudes)];
    // Room around the pins, and above Apple's logo and legal link at the foot.
    const span = new mapkit.CoordinateSpan(Math.max(north - south, CLOSEST_SPAN) * 1.6, Math.max(east - west, CLOSEST_SPAN) * 1.4);
    const middle = (north + south) / 2 - (north - south) * 0.08;
    instance.setRegionAnimated(new mapkit.CoordinateRegion(new mapkit.Coordinate(middle, (east + west) / 2), span), !prefersLessMotion());
    // `key` stands for the points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return (
    <div aria-label={label} className="shiori-candmap shiori-screen-only" role="region">
      <div className="shiori-candmap-canvas" ref={container} />
      {failed ? <p className="shiori-map-note">{failedText}</p> : null}
    </div>
  );
}
