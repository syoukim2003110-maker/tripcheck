import { appleRelayUrl } from "../apple-relay-client.ts";
import type { ShioriDay, ShioriLeg } from "./plan.ts";

/*
 * The printed booklet's maps. On paper there is no MapKit map, yet a printed
 * day carries what Apple said (the names of places found through Apple,
 * Apple's walking and driving minutes), and Apple's terms show that only
 * with the Apple map it belongs to. So each printed day carries one Apple
 * Maps Web Snapshot: a still image of Apple's map, with the day's numbered
 * stops, the hotel and the day's lines drawn by Apple on it, Apple's logo
 * and legal notice included.
 *
 * A snapshot URL has to be signed with the site's Maps key, so the page
 * describes the picture (op=snapshot) and the relay — which alone holds the
 * key — checks the description, fixes the colours and size, and signs a URL
 * that expires a quarter of an hour later. The URLs are asked for only when
 * the traveller prints, and nothing of the picture is kept.
 */

export type SnapshotPinKind = "stop" | "hotel";
export type SnapshotLineKind = "rail" | "street" | "straight" | "hotel";
export type SnapshotSpec = {
  /** [latitude, longitude, glyph ("1"–"9", "H" or ""), kind] */
  p: Array<[number, number, string, SnapshotPinKind]>;
  /** [kind, encoded polyline] */
  l: Array<[SnapshotLineKind, string]>;
};

/** What the relay takes, and what keeps its signed URL short enough for Apple. */
export const SNAPSHOT_LIMITS = { pins: 30, lines: 40, lineChars: 2_000, specBytes: 6_000, encodedChars: 3_000 } as const;

type Point = { latitude: number; longitude: number };

/** Google's encoded polyline (precision 5), the form Apple's snapshot overlays accept. */
export function encodePolyline(points: readonly Point[]): string {
  let output = "";
  let lastLat = 0;
  let lastLon = 0;
  const encode = (value: number) => {
    let rest = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (rest >= 0x20) {
      chunk += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest >>= 5;
    }
    return chunk + String.fromCharCode(rest + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.latitude * 1e5);
    const lon = Math.round(point.longitude * 1e5);
    output += encode(lat - lastLat) + encode(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return output;
}

/** At most `limit` points of a path, its ends always kept. */
function thin<T>(path: readonly T[], limit: number): T[] {
  if (path.length <= limit) return [...path];
  const step = (path.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => path[Math.round(index * step)]);
}

/**
 * The picture of one day as the screen's map draws it: the day's stops
 * numbered in order (a number from 10 on cannot be one character, so those
 * pins are left blank; the list beside it numbers every stop), the hotel,
 * and the day's legs — trains through their stations, walks and drives
 * along their streets, a way not known as a dashed straight line, the legs
 * to and from the hotel thin. Null for a day with no stop.
 */
export function daySnapshotSpec(day: Pick<ShioriDay, "stops" | "legs" | "fromHotel" | "toHotel">, hotel: { lat: number; lon: number } | null): SnapshotSpec | null {
  if (day.stops.length === 0) return null;
  const pins: SnapshotSpec["p"] = day.stops.slice(0, SNAPSHOT_LIMITS.pins - 1).map((stop, index) => [
    round(stop.place.lat), round(stop.place.lon), index < 9 ? String(index + 1) : "", "stop",
  ]);
  if (hotel) pins.push([round(hotel.lat), round(hotel.lon), "H", "hotel"]);
  const legs: Array<{ leg: ShioriLeg; hotelLeg: boolean }> = [
    ...(day.fromHotel ? [{ leg: day.fromHotel, hotelLeg: true }] : []),
    ...day.legs.map((leg) => ({ leg, hotelLeg: false })),
    ...(day.toHotel ? [{ leg: day.toHotel, hotelLeg: true }] : []),
  ].filter(({ leg }) => (leg.hasPath || leg.noPath) && leg.path.length > 1).slice(0, SNAPSHOT_LIMITS.lines);
  const kindOf = ({ leg, hotelLeg }: { leg: ShioriLeg; hotelLeg: boolean }): SnapshotLineKind =>
    !leg.hasPath ? "straight" : hotelLeg ? "hotel" : leg.mode === "rail" ? "rail" : "street";
  // Fewer points per line until the whole picture fits in a URL Apple takes.
  for (let limit = 60; ; limit = Math.max(2, Math.floor(limit / 2))) {
    const lines = legs.map((entry): [SnapshotLineKind, string] => [kindOf(entry), encodePolyline(thin(entry.leg.path, entry.leg.hasPath ? limit : 2))]);
    if (limit === 2 || lines.reduce((sum, [, line]) => sum + line.length, 0) <= SNAPSHOT_LIMITS.encodedChars) return { p: pins, l: lines };
  }
}

const round = (value: number) => Math.round(value * 1e5) / 1e5;

/** The description as the relay takes it: base64url of its JSON. */
export function snapshotSpecParam(spec: SnapshotSpec): string {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A signed snapshot URL for one day's picture, or null when the relay cannot
 * give one (no relay in this build, a spent budget, a refusal). The URL
 * expires about fifteen minutes after it is made.
 */
export async function requestSnapshotUrl(
  spec: SnapshotSpec,
  language: "ja-JP" | "en-US",
  relayUrl: string | null = appleRelayUrl(),
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<string | null> {
  if (!relayUrl) return null;
  const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
  const url = new URL(relayUrl, base);
  url.searchParams.set("op", "snapshot");
  url.searchParams.set("lang", language);
  url.searchParams.set("spec", snapshotSpecParam(spec));
  try {
    const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null) as { url?: unknown } | null;
    const signed = response.ok && typeof payload?.url === "string" ? payload.url : null;
    return signed && signed.startsWith("https://snapshot.apple-mapkit.com/api/v1/snapshot?") ? signed : null;
  } catch {
    return null;
  }
}
