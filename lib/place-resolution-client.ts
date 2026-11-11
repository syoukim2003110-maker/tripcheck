import type { DestinationChoice } from "./destinations.ts";
import type { Locale } from "./i18n.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import { resolveKnownStops } from "./route-optimizer.ts";
import { parsedWishlistPlaces } from "./wishlist-parser.ts";
import { PLANNING_BUDGET, takeWithinPlanningBudget } from "./planning-budget.ts";
import type { ShareableResolutionOverride } from "./share-link.ts";
import { tripRequestHeaders } from "./trip-request-identity.ts";
import type { AmbiguousPlaceResolution } from "./google-place-resolver.ts";
import { paidPlaceResolutionEnabled } from "./paid-place-opt-in.ts";
export type { AmbiguousPlaceResolution } from "./google-place-resolver.ts";

export type PlaceResolutionResponse = {
  provider: "google_maps" | "open_place_data";
  attribution?: {
    label: string;
    url: string;
  };
  fetchedAt: string;
  places: ResolvedInputStop[];
  hotel: ResolvedInputStop | null;
  ambiguous: AmbiguousPlaceResolution[];
};

export type PlaceReviewStatus = "parsed" | "confirmed" | "review" | "unresolved";

export function placeReviewInputSignature(
  raw: string,
  locale: Locale,
  destination: DestinationChoice,
) {
  return JSON.stringify([raw.trim(), locale, destination]);
}

export function resolvedPlaceCountryCodes(places: readonly ResolvedInputStop[]) {
  return [...new Set(places.flatMap((place) => place.countryCode ? [place.countryCode] : []))];
}

/** Auto mode must never turn a cross-country shortlist into one itinerary. */
export function hasMixedResolvedPlaceCountries(places: readonly ResolvedInputStop[]) {
  return resolvedPlaceCountryCodes(places).length > 1;
}

/**
 * Keeps presentation state separate from lookup transport. A completed direct
 * build is a review just like the explicit review step: provider/catalog hits
 * are confirmed, ambiguous results need a choice, and only the remainder is
 * unresolved.
 */
export function placeReviewStatus(input: {
  reviewCompleted: boolean;
  hasResolvedPlace: boolean;
  hasAmbiguousMatch: boolean;
}): PlaceReviewStatus {
  if (!input.reviewCompleted) return "parsed";
  if (input.hasResolvedPlace) return "confirmed";
  if (input.hasAmbiguousMatch) return "review";
  return "unresolved";
}

export class PlaceResolutionError extends Error {
  code: "not_configured" | "invalid_request" | "quota_exhausted" | "unavailable";

  constructor(code: PlaceResolutionError["code"]) {
    super(code);
    this.code = code;
  }
}

/**
 * Counts the unique names that need an external lookup after deterministic
 * seed matches are removed. Keeping this calculation beside the request
 * builder lets the UI disclose the hard provider budget before anything is
 * silently left unresolved.
 */
export function placeResolutionQueryCount(raw: string, locale: Locale) {
  return new Set(parsedWishlistPlaces(raw).flatMap(({ name }) => (
    resolveKnownStops(name, locale).length > 0 ? [] : [name]
  ))).size;
}

export function buildPlaceResolutionPayload(
  raw: string,
  hotelQuery: string,
  locale: Locale,
  destination: DestinationChoice = "auto",
  resolutionOverrides: ShareableResolutionOverride[] = [],
) {
  // The shared wishlist parser strips day headings, times and marker words, so
  // a resolver receives clean place names and never any schedule detail.
  const places = parsedWishlistPlaces(raw);
  const normalizedHotelQuery = hotelQuery.trim() || null;
  // The keyless resolver is not metered per call, so it may place a whole
  // week's wishlist. The paid ceiling applies only once a deployment has
  // opted into paid resolution, because the same payload may then be replayed
  // against the metered route.
  const budget = paidPlaceResolutionEnabled()
    ? PLANNING_BUDGET.placeResolutions
    : PLANNING_BUDGET.openPlaceResolutions;
  const usedInputIndexes = new Set<number>();
  const overriddenInputIndexes = new Set<number>();
  const providerChoices: Array<{ inputIndex: number; input: string; providerRef: string }> = [];

  // A share decision is occurrence-scoped. Both manual pins and provider IDs
  // suppress Text Search for that occurrence: manual pins are rebuilt by the
  // client, while an exact provider lookup must never degrade to a fuzzy
  // lookup if its ID has expired or been deleted.
  for (const override of resolutionOverrides) {
    if (overriddenInputIndexes.size >= budget) break;
    const inputIndex = override?.inputIndex;
    if (
      typeof inputIndex !== "number"
      || !Number.isSafeInteger(inputIndex)
      || inputIndex < 0
      || inputIndex >= places.length
      || usedInputIndexes.has(inputIndex)
    ) continue;

    if (Object.prototype.hasOwnProperty.call(override, "providerRef")) {
      const providerRef = (override as { providerRef?: unknown }).providerRef;
      if (typeof providerRef !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(providerRef)) continue;
      usedInputIndexes.add(inputIndex);
      overriddenInputIndexes.add(inputIndex);
      providerChoices.push({ inputIndex, input: places[inputIndex].name, providerRef });
      continue;
    }

    const manual = override as Partial<Extract<ShareableResolutionOverride, { name: string }>>;
    if (
      typeof manual.name !== "string" || manual.name.trim().length === 0 || manual.name.trim().length > 120
      || typeof manual.address !== "string" || manual.address.trim().length > 240
      || typeof manual.latitude !== "number" || !Number.isFinite(manual.latitude)
      || manual.latitude < -90 || manual.latitude > 90
      || typeof manual.longitude !== "number" || !Number.isFinite(manual.longitude)
      || manual.longitude < -180 || manual.longitude > 180
    ) continue;
    usedInputIndexes.add(inputIndex);
    overriddenInputIndexes.add(inputIndex);
  }

  const hotelEvents = normalizedHotelQuery ? 1 : 0;
  const providerOverrides = takeWithinPlanningBudget(
    providerChoices,
    budget,
    hotelEvents,
  );
  const queries = places.flatMap(({ name }, inputIndex) => (
    overriddenInputIndexes.has(inputIndex) || resolveKnownStops(name, locale).length > 0 ? [] : [name]
  ));
  return {
    // One trip-scoped ceiling protects cost. Anything beyond it remains
    // visibly unresolved rather than being silently treated as a real pin.
    // The hotel is a provider event too, so it consumes one of the same twelve
    // units instead of creating a request the gateway must reject as 13/12.
    queries: takeWithinPlanningBudget(
      [...new Set(queries)],
      budget,
      hotelEvents + providerOverrides.length,
    ),
    providerOverrides,
    hotelQuery: normalizedHotelQuery,
    languageCode: locale === "ja" ? "ja" as const : "en" as const,
    destination,
  };
}

export async function requestPlaceResolution(
  raw: string,
  hotelQuery: string,
  locale: Locale,
  destination: DestinationChoice = "auto",
  signal?: AbortSignal,
  resolutionOverrides: ShareableResolutionOverride[] = [],
): Promise<PlaceResolutionResponse> {
  const payload = buildPlaceResolutionPayload(raw, hotelQuery, locale, destination, resolutionOverrides);
  if (payload.queries.length === 0 && payload.providerOverrides.length === 0 && !payload.hotelQuery) {
    return { provider: "open_place_data", fetchedAt: "", places: [], hotel: null, ambiguous: [] };
  }
  const encodedPayload = JSON.stringify(payload);
  const postResolution = (path: string) => fetch(path, {
    method: "POST",
    headers: tripRequestHeaders({ "Content-Type": "application/json" }),
    body: encodedPayload,
    signal,
  });

  let openResponse: Response | null = null;
  try {
    openResponse = await postResolution("/api/place-resolution/open");
  } catch {
    if (signal?.aborted) throw new PlaceResolutionError("unavailable");
  }

  const openBody = openResponse
    ? await openResponse.json().catch(() => null) as (PlaceResolutionResponse & { code?: string }) | null
    : null;
  const openSucceeded = Boolean(openResponse?.ok && openBody);
  const exactGoogleChoiceNeedsOptedInProvider = payload.providerOverrides.length > 0
    && paidPlaceResolutionEnabled();
  if (openSucceeded && openBody && !exactGoogleChoiceNeedsOptedInProvider) {
    return { ...openBody, ambiguous: Array.isArray(openBody.ambiguous) ? openBody.ambiguous : [] };
  }

  // A malformed or cross-origin request must never be retried through a
  // different boundary. Provider failure may use Google only after the
  // deployment explicitly opts into paid place resolution.
  const openMayUsePaidFallback = openResponse === null
    || openResponse.status === 429
    || openResponse.status >= 500
    || (openResponse.ok && openBody === null);
  if (!paidPlaceResolutionEnabled() || (!openMayUsePaidFallback && !exactGoogleChoiceNeedsOptedInProvider)) {
    if (openBody?.code === "invalid_request" || openResponse?.status === 400) {
      throw new PlaceResolutionError("invalid_request");
    }
    if (openResponse?.status === 429) throw new PlaceResolutionError("quota_exhausted");
    throw new PlaceResolutionError("unavailable");
  }

  let paidResponse: Response;
  try {
    paidResponse = await postResolution("/api/place-resolution");
  } catch {
    if (openSucceeded && openBody) {
      return { ...openBody, ambiguous: Array.isArray(openBody.ambiguous) ? openBody.ambiguous : [] };
    }
    throw new PlaceResolutionError("unavailable");
  }
  const paidBody = await paidResponse.json().catch(() => null) as (PlaceResolutionResponse & { code?: string }) | null;
  if (!paidResponse.ok || !paidBody) {
    if (openSucceeded && openBody) {
      return { ...openBody, ambiguous: Array.isArray(openBody.ambiguous) ? openBody.ambiguous : [] };
    }
    if (paidBody?.code === "not_configured") throw new PlaceResolutionError("not_configured");
    if (paidBody?.code === "invalid_request") throw new PlaceResolutionError("invalid_request");
    if (paidResponse.status === 429 || paidBody?.code === "budget_exhausted") {
      throw new PlaceResolutionError("quota_exhausted");
    }
    throw new PlaceResolutionError("unavailable");
  }
  return { ...paidBody, ambiguous: Array.isArray(paidBody.ambiguous) ? paidBody.ambiguous : [] };
}
