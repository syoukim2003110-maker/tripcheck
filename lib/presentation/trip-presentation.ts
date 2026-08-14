// Domain-to-display transforms shared by the planner surfaces: dates,
// durations, distances, clocks, addresses, payment labels, airport option
// groups and hotel price bands. Pure functions - no React.
import { destinationName, destinations, priceBandSymbols, type Destination } from "../destinations.ts";
import { straightLineDistanceKm, type ResolvedInputStop, type RouteStop } from "../route-optimizer.ts";
import type { PlaceIntelligenceResult } from "../place-intelligence.ts";
import type { HotelPriceLevel } from "../google-hotels.ts";
import type { AirportCode } from "../trip-builder.ts";
import { parsedWishlistPlaces } from "../wishlist-parser.ts";
import type { PlannerLocale } from "./planner-copy.ts";

export const weekdayNames = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
} as const;

export function weekdayInfo(date: string | null | undefined, locale: PlannerLocale) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = parsed.getUTCDay();
  return { label: weekdayNames[locale][day], isWeekend: day === 0 || day === 6, isSunday: day === 0 };
}

export function formatDistanceMeters(meters: number) {
  return meters < 950 ? `${Math.max(10, Math.round(meters / 10) * 10)}m` : `${(meters / 1000).toFixed(1)}km`;
}

export function placeCandidateLabel(candidate: ResolvedInputStop, anchors: ResolvedInputStop[], locale: PlannerLocale) {
  const nearest = anchors
    .filter((anchor) => anchor.id !== candidate.id)
    .map((anchor) => straightLineDistanceKm(candidate, anchor))
    .sort((left, right) => left - right)[0];
  const type = candidate.placeTypes?.[0]?.replaceAll("_", " ");
  const parts = [
    candidate.address || candidate.area,
    candidate.countryCode,
    type,
    typeof nearest === "number" && Number.isFinite(nearest)
      ? locale === "ja" ? `他の場所から約${nearest.toFixed(nearest < 10 ? 1 : 0)}km` : `about ${nearest.toFixed(nearest < 10 ? 1 : 0)} km from another stop`
      : null,
  ].filter(Boolean);
  return `${candidate.name} — ${parts.join(" · ")}`;
}

export function resolvedStopAddress(stop: RouteStop | ResolvedInputStop | null | undefined) {
  if (!stop) return "";
  return "address" in stop && typeof stop.address === "string" && stop.address ? stop.address : stop.area;
}

export function safeRemovedStopLabels(
  removed: readonly { id: string; name: string }[],
  raw: string,
  locale: PlannerLocale,
) {
  const authoredNames = new Set(parsedWishlistPlaces(raw).map((place) => place.name));
  const fallback = locale === "ja" ? "除外した場所" : "Removed place";
  return removed.map((entry) => ({
    id: entry.id,
    name: authoredNames.has(entry.name) ? entry.name : fallback,
  }));
}

export const priceLevelOrder: HotelPriceLevel[] = ["inexpensive", "moderate", "expensive", "very_expensive"];

/* Google's price level is a relative band, so it is rendered in the local
 * currency's glyph rather than a fixed yen sign. */
export function priceBand(level: HotelPriceLevel | null, destination: Destination) {
  if (level === null) return null;
  return priceBandSymbols(destination)[priceLevelOrder.indexOf(level)] ?? null;
}

export type AirportGroup = { label: string | null; options: Array<{ value: AirportCode; label: string }> };

export function airportOptionsFor(locale: PlannerLocale, destination: Destination): AirportGroup[] {
  const gateways = (candidate: Destination) => candidate.airports.map((airport) => ({
    value: airport.code as AirportCode,
    label: `${airport.code} · ${locale === "ja" ? airport.names.ja : airport.names.en}`,
  }));
  const empty: AirportGroup = { label: null, options: [{ value: "none", label: locale === "ja" ? "未指定" : "Not specified" }] };
  if (destination.id !== "worldwide") return [empty, { label: null, options: gateways(destination) }];
  // Before a country is known, offer every gateway grouped by country: a
  // traveller should be able to enter their flight before the first build.
  return [
    empty,
    ...destinations
      .filter((candidate) => candidate.airports.length > 0)
      .map((candidate) => ({ label: destinationName(candidate, locale), options: gateways(candidate) }))
      .sort((left, right) => left.label.localeCompare(right.label, locale === "ja" ? "ja" : "en")),
  ];
}

export function airportComparisonDestination(active: Destination, airportCode: AirportCode) {
  if (active.id !== "worldwide" || airportCode === "none") return active;
  return destinations.find((candidate) => candidate.airports.some((airport) => airport.code === airportCode)) ?? active;
}

export function formatDuration(minutes: number, locale: PlannerLocale) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (locale === "ja") return hours > 0 ? `${hours}時間${remainder > 0 ? `${remainder}分` : ""}` : `${remainder}分`;
  return hours > 0 ? `${hours}h${remainder > 0 ? ` ${remainder}m` : ""}` : `${remainder}m`;
}

/** Copy Deck plan.stats: the one compact trip-totals line under the state
 * headline — places, total travel, total buffer (ja 「8か所・移動8時間40分・
 * 余裕4時間10分」 / en "8 places · 8h 40m travel · 4h 10m buffer"). TC-029:
 * this is a single line, never an audit block — verification counts stay in
 * the verdict details. Callers pass the plan's existing totals (the same
 * numbers the collapsed details use), never a fresh computation.
 *
 * `spareDays` REPLACES the buffer clause rather than joining it. The engine
 * has always computed that number and nothing ever read it, so a four-day
 * trip whose places fit in three reported 「余裕22時間」 and left the reader
 * to conclude "comfortable" from a figure that actually means "a whole day of
 * this trip has nothing in it". Both are the same spare time at different
 * resolutions, and when it amounts to whole days the day count is the honest
 * one — so the line swaps clauses instead of growing a fourth, which is what
 * keeps it one line inside the first-viewport contract.
 *
 * It stays silent whenever the assessment withholds a conclusion
 * (`spareDays === null`, which is what an unresolved place or a trip that
 * does not fit produces), so emptiness is never claimed on thin evidence. */
export type TripStatsTotals = {
  placeCount: number;
  travelMinutes: number;
  bufferMinutes: number;
  spareDays?: number | null;
};

/** The line's three clauses and the separator between them.
 *
 * v3.1 §4.2 tints the spare clause green, which needs the clauses as elements
 * rather than one string. `tripStatsLine` is this joined, so the rendered text
 * is provably the same sentence it has always been — the colour is the only
 * addition, and the deck-form assertions keep holding it to that. */
export function tripStatsParts(totals: TripStatsTotals, locale: PlannerLocale) {
  const travel = formatDuration(totals.travelMinutes, locale);
  const hasSpareDays = typeof totals.spareDays === "number" && totals.spareDays > 0;
  if (locale === "ja") {
    return {
      separator: "・",
      places: `${totals.placeCount}か所`,
      travel: `移動${travel}`,
      spare: hasSpareDays ? `${totals.spareDays}日分の空き` : `余裕${formatDuration(totals.bufferMinutes, locale)}`,
    };
  }
  return {
    separator: " · ",
    places: `${totals.placeCount} place${totals.placeCount === 1 ? "" : "s"}`,
    travel: `${travel} travel`,
    spare: hasSpareDays
      ? `${totals.spareDays} day${totals.spareDays === 1 ? "" : "s"} spare`
      : `${formatDuration(totals.bufferMinutes, locale)} buffer`,
  };
}

export function tripStatsLine(totals: TripStatsTotals, locale: PlannerLocale) {
  const parts = tripStatsParts(totals, locale);
  return [parts.places, parts.travel, parts.spare].join(parts.separator);
}

export function formatWindowClock(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(normalized / 60)}:${String(normalized % 60).padStart(2, "0")}`;
}

export function shiftPlannerClock(value: string, minutes: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const total = Number(match[1]) * 60 + Number(match[2]);
  if (!Number.isFinite(total)) return value;
  const shifted = Math.max(0, Math.min(23 * 60 + 59, total + minutes));
  return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
}

export function googleMapsSearchUrl(stop: RouteStop) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.name} ${stop.area}`)}`;
}

export function formatCheckedAt(value: string, locale: PlannerLocale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function paymentLabel(intel: PlaceIntelligenceResult, locale: PlannerLocale) {
  const payment = intel.place.payment;
  if (payment.cashOnly === true) return locale === "ja" ? "現金のみ（Google掲載）" : "Cash only · Google listing";
  if (payment.creditCards === true) return locale === "ja" ? "カード可（Google掲載）" : "Cards accepted · Google listing";
  const observations = payment.observations;
  if (observations.length === 0) return null;
  const hasConflict = observations.some((item) => item.method === "card" && item.accepted)
    && observations.some((item) => item.method === "card" && !item.accepted);
  if (hasConflict) return locale === "ja" ? "支払いの口コミが分かれています" : "Payment reports conflict";
  const observation = observations[0];
  if (observation.method === "cash") return locale === "ja" ? "口コミ: 現金のみとの報告" : "Review: cash only reported";
  if (observation.method === "card" && !observation.accepted) return locale === "ja" ? "口コミ: カード不可との報告" : "Review: cards not accepted";
  if (observation.method === "qr") return observation.accepted
    ? (locale === "ja" ? "口コミ: コード決済の利用報告" : "Review: code payment reported")
    : (locale === "ja" ? "口コミ: コード決済不可との報告" : "Review: code payment not accepted");
  if (observation.method === "transport_ic") return observation.accepted
    ? (locale === "ja" ? "口コミ: 交通系ICの利用報告" : "Review: transit IC reported")
    : (locale === "ja" ? "口コミ: 交通系IC不可との報告" : "Review: transit IC not accepted");
  return locale === "ja" ? "口コミ: カード利用の報告" : "Review: card payment reported";
}
