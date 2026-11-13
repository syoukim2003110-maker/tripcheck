import { appleRelayUrl } from "./apple-relay-client.ts";

/*
 * Restaurants with a photo and a budget, from HotPepper Gourmet through the
 * site's own relay (the key never reaches the browser). Japan only, and only
 * the shops listed there. The provider's terms forbid keeping a copy, so
 * nothing here is written to storage: an answer lives as long as the page.
 */

export type HotpepperShop = Readonly<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  genre: string | null;
  /** Dinner budget band as the provider words it, e.g. "2001～3000円". */
  budget: string | null;
  budgetAverage: string | null;
  catchCopy: string | null;
  open: string | null;
  photo: string | null;
  url: string | null;
  /** Straight-line metres from the point asked about. */
  distanceMeters: number;
}>;

export type HotpepperQuery = Readonly<{
  near: { latitude: number; longitude: number };
  withinMeters?: number;
  name?: string;
  meal?: "lunch" | "dinner";
  signal?: AbortSignal;
}>;

/** True once the relay has said it holds no key: it is not asked again. */
let unavailable = false;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function link(value: unknown) {
  const url = text(value);
  return url && /^https:\/\/[a-z0-9.-]+\.(?:hotp\.jp|hotpepper\.jp)\//.test(url) ? url : null;
}

export function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const lat = (b.latitude - a.latitude) * 111_320;
  const lon = (b.longitude - a.longitude) * 111_320 * Math.cos(((a.latitude + b.latitude) / 2) * Math.PI / 180);
  return Math.hypot(lat, lon);
}

/** The relay's answer as shops, nearest first; anything malformed is dropped. */
export function parseHotpepperShops(payload: unknown, near: { latitude: number; longitude: number }): HotpepperShop[] {
  const results = payload && typeof payload === "object" ? (payload as { results?: unknown }).results : null;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw): HotpepperShop[] => {
    if (!raw || typeof raw !== "object") return [];
    const shop = raw as Record<string, unknown>;
    const name = text(shop.name);
    const latitude = Number(shop.latitude);
    const longitude = Number(shop.longitude);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    return [{
      id: text(shop.id) ?? `${name}|${latitude.toFixed(5)},${longitude.toFixed(5)}`,
      name,
      latitude,
      longitude,
      address: text(shop.address),
      genre: text(shop.genre),
      budget: text(shop.budget),
      budgetAverage: text(shop.budgetAverage),
      catchCopy: text(shop.catch),
      open: text(shop.open),
      photo: link(shop.photo),
      url: link(shop.url),
      distanceMeters: Math.round(metresBetween(near, { latitude, longitude })),
    }];
  }).sort((left, right) => left.distanceMeters - right.distanceMeters);
}

/** Shops near a point. An empty list when the relay has no key or no answer. */
export async function fetchHotpepperShops(
  query: HotpepperQuery,
  relayUrl: string | null = appleRelayUrl(),
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<HotpepperShop[]> {
  if (!relayUrl || unavailable) return [];
  const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
  const url = new URL(relayUrl, base);
  url.searchParams.set("op", "food");
  url.searchParams.set("near", `${query.near.latitude.toFixed(5)},${query.near.longitude.toFixed(5)}`);
  if (query.withinMeters) url.searchParams.set("within", String(Math.round(query.withinMeters)));
  if (query.name) url.searchParams.set("name", query.name.slice(0, 60));
  if (query.meal === "lunch") url.searchParams.set("meal", "lunch");
  try {
    const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: query.signal });
    const payload = await response.json().catch(() => null) as { code?: unknown } | null;
    if (!response.ok) {
      if (payload?.code === "not_configured") unavailable = true;
      return [];
    }
    return parseHotpepperShops(payload, query.near);
  } catch {
    return [];
  }
}

/** Japan, roughly: the provider lists nothing elsewhere, so nothing is asked. */
export function inJapan(point: { latitude: number; longitude: number }) {
  return point.latitude > 24 && point.latitude < 46 && point.longitude > 122.5 && point.longitude < 146.5;
}

/** A plain yen figure for a budget band: "2001～3000円" → "2,001〜3,000円". */
export function budgetLabel(budget: string | null) {
  if (!budget) return null;
  const figures = budget.match(/\d+/g);
  if (!figures) return null;
  const yen = (value: string) => Number(value).toLocaleString("ja-JP");
  if (figures.length >= 2) return `${yen(figures[0])}〜${yen(figures[1])}円`;
  return /～\s*\d|〜\s*\d/.test(budget) ? `〜${yen(figures[0])}円` : `${yen(figures[0])}円〜`;
}

/** The lunch price inside the provider's free-text average, when it names one: "ランチ 880円、ディナー…" → "880円". */
export function lunchPrice(average: string | null) {
  if (!average) return null;
  const named = average.match(/(?:ランチ|昼食|昼)[^\d]{0,6}(\d[\d,]*)/) ?? average.match(/(\d[\d,]*)\s*円\s*[（(]\s*ランチ/);
  if (!named) return null;
  const yen = Number(named[1].replace(/,/g, ""));
  return yen >= 300 && yen <= 30_000 ? `${yen.toLocaleString("ja-JP")}円` : null;
}
