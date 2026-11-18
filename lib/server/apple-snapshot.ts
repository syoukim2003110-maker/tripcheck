import { createSign } from "node:crypto";

/*
 * The relay's op=snapshot, as the local relay runs it (deploy/xserver/api/
 * apple.php does the same in PHP): the page describes one printed day's
 * picture, and the relay checks it, fixes everything else about the image
 * (size, style, colours, a quarter-hour expiry) and signs the URL with the
 * Maps key, which never leaves the server. Contract:
 *
 *   GET apple.php?op=snapshot&lang=ja-JP|en-US&spec=<base64url JSON>
 *       spec: {"p":[[lat,lon,glyph,"stop"|"hotel"],…],      1–30 pins
 *              "l":[["rail"|"street"|"straight"|"hotel","<encoded polyline>"],…]}  0–40 lines
 *       glyph: "" or one of 1–9 and H; polyline: 2–2000 characters of the
 *       encoded-polyline alphabet (ASCII 63–126); the JSON at most 6000 bytes.
 *   The picture is framed on the pins (center and spn), 600×400 at scale 2,
 *   Apple's muted style with its points of interest off, in the page's language.
 *   200 {"url":"https://snapshot.apple-mapkit.com/api/v1/snapshot?…&signature=…","expiresAt":<unix seconds>}
 *
 * See "Generating a URL and Signature to Create a Maps Web Snapshot" in
 * Apple's documentation: the path and query, teamId and keyId last but one,
 * are signed with ES256 and the base64url signature is appended last.
 */

export const SNAPSHOT_ORIGIN = "https://snapshot.apple-mapkit.com";
export const SNAPSHOT_SIZE = "600x400";
export const SNAPSHOT_LIFETIME_SECONDS = 900;
/** Longer URLs are refused before they reach Apple (Apple answers 414 for too long a URL). */
export const SNAPSHOT_MAX_URL = 8_000;

const PIN_COLORS = { stop: "1967D2", hotel: "1F2937" } as const;
const LINE_STYLES = {
  rail: { strokeColor: "1967D2", lineWidth: 5 },
  street: { strokeColor: "1967D2", lineWidth: 4 },
  hotel: { strokeColor: "1967D2", lineWidth: 2, strokeOpacity: 0.5 },
  // A way that could not be looked up: grey, dashed, never mistaken for a route.
  straight: { strokeColor: "6B7280", lineWidth: 2, lineDash: [5, 5] },
} as const;

export type SnapshotRequest = {
  pins: Array<{ lat: number; lon: number; glyph: string; kind: keyof typeof PIN_COLORS }>;
  lines: Array<{ kind: keyof typeof LINE_STYLES; points: string }>;
};

/** The page's description, checked; null when anything in it is not exactly as the contract says. */
export function readSnapshotSpec(raw: string | null): SnapshotRequest | null {
  if (!raw || raw.length > 8_100 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let spec: unknown;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    if (Buffer.byteLength(json) > 6_000) return null;
    spec = JSON.parse(json);
  } catch {
    return null;
  }
  const { p, l } = (spec ?? {}) as { p?: unknown; l?: unknown };
  if (!Array.isArray(p) || p.length < 1 || p.length > 30 || !Array.isArray(l) || l.length > 40) return null;
  const pins: SnapshotRequest["pins"] = [];
  for (const entry of p) {
    if (!Array.isArray(entry) || entry.length !== 4) return null;
    const [lat, lon, glyph, kind] = entry as unknown[];
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 90 || Math.abs(lon) >= 180) return null;
    if (typeof glyph !== "string" || !/^[1-9H]?$/.test(glyph) || (kind !== "stop" && kind !== "hotel")) return null;
    pins.push({ lat, lon, glyph, kind });
  }
  const lines: SnapshotRequest["lines"] = [];
  for (const entry of l) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [kind, points] = entry as unknown[];
    if (typeof kind !== "string" || !Object.hasOwn(LINE_STYLES, kind)) return null;
    if (typeof points !== "string" || !/^[\x3f-\x7e]{2,2000}$/.test(points)) return null;
    lines.push({ kind: kind as keyof typeof LINE_STYLES, points });
  }
  return { pins, lines };
}

/** RFC 3986 encoding, as PHP's http_build_query(…, PHP_QUERY_RFC3986) writes it. */
const rfc3986 = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Where the picture looks and how much it takes in: every pin, with room
 * around it for the pin's head above and Apple's logo at the foot (Apple's
 * own "auto" frame puts the outermost pins on the edge).
 */
export function snapshotFrame(pins: SnapshotRequest["pins"]): [center: string, span: string] {
  const latitudes = pins.map((pin) => pin.lat);
  const longitudes = pins.map((pin) => pin.lon);
  const [south, north, west, east] = [Math.min(...latitudes), Math.max(...latitudes), Math.min(...longitudes), Math.max(...longitudes)];
  const latitudeSpan = Math.max((north - south) * 1.6, 0.006);
  const longitudeSpan = Math.max((east - west) * 1.35, 0.009);
  // A little north of the middle: the pins' heads stand above their points.
  const middle = (north + south) / 2 + (north - south) * 0.06;
  const fixed = (value: number) => value.toFixed(5);
  return [`${fixed(middle)},${fixed((east + west) / 2)}`, `${fixed(latitudeSpan)},${fixed(longitudeSpan)}`];
}

/** The path and query that are signed (everything but the signature), in the order sent. */
export function snapshotPath(request: SnapshotRequest, language: "ja-JP" | "en-US", expiresAt: number, teamId: string, keyId: string): string {
  const annotations = request.pins.map((pin) => ({
    point: `${pin.lat},${pin.lon}`,
    color: PIN_COLORS[pin.kind],
    markerStyle: "balloon",
    ...(pin.glyph ? { glyphText: pin.glyph } : {}),
  }));
  const overlays = request.lines.map((line) => ({ points: line.points, ...LINE_STYLES[line.kind] }));
  const [center, span] = snapshotFrame(request.pins);
  const params: Array<[string, string]> = [
    ["center", center],
    ["spn", span],
    ["size", SNAPSHOT_SIZE],
    ["scale", "2"],
    ["t", "mutedStandard"],
    ["colorScheme", "light"],
    ["poi", "0"],
    ["lang", language],
    ["annotations", JSON.stringify(annotations)],
    ...(overlays.length > 0 ? [["overlays", JSON.stringify(overlays)] as [string, string]] : []),
    ["expires", String(expiresAt)],
    ["teamId", teamId],
    ["keyId", keyId],
  ];
  return `/api/v1/snapshot?${params.map(([key, value]) => `${key}=${rfc3986(value)}`).join("&")}`;
}

/** The whole signed URL: the path signed with ES256 (raw r‖s), the base64url signature last. */
export function signSnapshotPath(path: string, privateKey: string): string {
  const signature = createSign("SHA256").update(path).sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${SNAPSHOT_ORIGIN}${path}&signature=${signature.toString("base64url")}`;
}
