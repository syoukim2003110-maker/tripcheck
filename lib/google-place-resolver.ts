import type { Destination, DestinationChoice } from "./destinations.ts";
import { destinationById, destinationPlaceQuery, isDestinationChoice, withinBounds } from "./destinations.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import { estimateStayMinutes } from "./stay-estimates.ts";
import { PLANNING_BUDGET } from "./planning-budget.ts";

export type PlaceResolutionRequest = {
  queries: string[];
  /** Explicit traveller choices rehydrated by stable Google Place ID. */
  providerOverrides: PlaceResolutionProviderOverride[];
  hotelQuery: string | null;
  languageCode: "en" | "ja";
  /** "auto" resolves worldwide and lets the answer name the country. */
  destination: DestinationChoice;
};

export type PlaceResolutionProviderOverride = {
  inputIndex: number;
  input: string;
  providerRef: string;
};

export type AmbiguousPlaceResolution = {
  input: string;
  candidates: ResolvedInputStop[];
};

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

const providerRefPattern = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_INPUT_INDEX = 3_999;

function parseProviderOverrides(value: unknown): PlaceResolutionProviderOverride[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PLANNING_BUDGET.placeResolutions) return null;
  const result: PlaceResolutionProviderOverride[] = [];
  const usedInputIndexes = new Set<number>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    const input = boundedText(source.input, 1, 120);
    if (
      typeof source.inputIndex !== "number"
      || !Number.isSafeInteger(source.inputIndex)
      || source.inputIndex < 0
      || source.inputIndex > MAX_INPUT_INDEX
      || usedInputIndexes.has(source.inputIndex)
      || !input
      || typeof source.providerRef !== "string"
      || !providerRefPattern.test(source.providerRef)
    ) return null;
    usedInputIndexes.add(source.inputIndex);
    result.push({ inputIndex: source.inputIndex, input, providerRef: source.providerRef });
  }
  return result;
}

export function parsePlaceResolutionRequest(input: unknown): PlaceResolutionRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (candidate.languageCode !== "en" && candidate.languageCode !== "ja") return null;
  if (!Array.isArray(candidate.queries) || candidate.queries.length > PLANNING_BUDGET.placeResolutions) return null;
  const parsedQueries = candidate.queries.map((query) => boundedText(query, 1, 120));
  if (parsedQueries.some((query) => query === null)) return null;
  const queries = [...new Set(parsedQueries as string[])];
  const providerOverrides = parseProviderOverrides(candidate.providerOverrides);
  if (!providerOverrides) return null;
  const hotelQuery = candidate.hotelQuery === null || candidate.hotelQuery === ""
    ? null
    : boundedText(candidate.hotelQuery, 1, 120);
  if (candidate.hotelQuery && !hotelQuery) return null;
  return {
    queries,
    providerOverrides,
    hotelQuery,
    languageCode: candidate.languageCode,
    destination: isDestinationChoice(candidate.destination) ? candidate.destination : "auto",
  };
}

/*
 * The short area label under a stop name. Japanese addresses put the useful
 * unit (prefecture + municipality) inside one unsplit string; most other
 * countries put it in the second-to-last comma part ("… , Zermatt, Switzerland").
 * The country name and a postal code are never a useful area label.
 */
export function areaFromAddress(address: string, fallback: string, destination: Destination) {
  const prefecture = address.match(/北海道|東京都|(?:京都|大阪)府|[\p{Script=Han}]{2,3}県/u);
  if (prefecture) {
    const following = address.slice((prefecture.index ?? 0) + prefecture[0].length);
    const municipality = following.match(/^[^\s,、市区町村]{1,8}[市区町村]/)?.[0] ?? "";
    return `${prefecture[0]}${municipality}`;
  }
  const countryWords = new Set(
    [destination.querySuffix, ...Object.values(destination.names)]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLocaleLowerCase()),
  );
  // Japanese-locale formatting of a FOREIGN address is space-separated with
  // the country first — "スイス 〒3920 ツェルマット ゴルネルグラート" — and
  // the town sits immediately after the postal token.
  if (!address.includes(",")) {
    const tokens = address.split(/\s+/).filter(Boolean)
      .filter((token) => !countryWords.has(token.toLocaleLowerCase()));
    const postalAt = tokens.findIndex((token) => /^〒?\d{3,6}(?:-\d{2,4})?$/.test(token));
    const town = postalAt >= 0 ? tokens[postalAt + 1] : undefined;
    if (town) return town;
  }
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const useful = parts.filter((part) => (
    !countryWords.has(part.toLocaleLowerCase())
    && !/^(?:japan|〒?\d{3}-?\d{4})$/i.test(part)
    // A bare postal code ("8001", "CH-3920", "SW1A 1AA") is never an area name.
    && !/^[A-Z]{0,2}[-\s]?\d[\dA-Z\s-]{2,9}$/i.test(part)
  ));
  // Prefer the second-to-last remaining part (usually the district above the
  // town) — but not when it is plainly the street line ("Bahnhofstrasse 1"),
  // which the last part never is.
  const streetLike = (part: string) => /\d/.test(part) && /^\d|\s\d+[a-z]?$/i.test(part);
  const secondToLast = useful.at(-2);
  const label = secondToLast && !streetLike(secondToLast) ? secondToLast : useful.at(-1);
  // Much of Europe writes the postal code in front of the town ("3920 Zermatt",
  // ja-locale "〒3920 ツェルマット") and some formats append it ("Tokyo 111-0032").
  if (!label) return fallback;
  const cleaned = label
    .replace(/^(?:〒\s*|[A-Z]{1,2}-)?\d{3,6}(?:-\d{2,4})?\s+/i, "")
    .replace(/\s+〒?\d{3,6}(?:-\d{2,4})?$/, "")
    .trim();
  // A provider occasionally returns only a street address. It is useful in
  // the detail panel, but it is not a sensible geographic theme for a day.
  return cleaned && !streetLike(cleaned) ? cleaned : fallback;
}

function countryCodeFromComponents(components: unknown) {
  if (!Array.isArray(components)) return undefined;
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const component = raw as { types?: unknown; shortText?: unknown };
    if (!Array.isArray(component.types) || !component.types.includes("country")) continue;
    const code = typeof component.shortText === "string" ? component.shortText.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return undefined;
}

type GooglePlaceSearchResult = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: unknown;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  primaryType?: string;
  types?: string[];
};

const routeBuildingFieldMask = "id,displayName,formattedAddress,addressComponents,location,googleMapsUri,primaryType,types";

function normalizePlaceName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function resolvedPlaceFromGoogle(
  input: string,
  place: GooglePlaceSearchResult,
  destination: Destination,
  verifiedAt: string,
): ResolvedInputStop | null {
  const name = place.displayName?.text?.trim();
  const address = place.formattedAddress?.trim() ?? "";
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  const sourceUrl = place.googleMapsUri?.trim();
  if (!place.id || !name || !sourceUrl || typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (!withinBounds(destination.bounds, latitude, longitude)) return null;
  const placeTypes = [...new Set([
    ...(typeof place.primaryType === "string" ? [place.primaryType] : []),
    ...(Array.isArray(place.types) ? place.types.filter((type): type is string => typeof type === "string") : []),
  ])];
  const countryCode = countryCodeFromComponents(place.addressComponents);
  return {
    id: `google-${place.id}`,
    providerRef: place.id,
    input,
    name,
    area: areaFromAddress(address, name, destination),
    address,
    ...(countryCode ? { countryCode } : {}),
    latitude,
    longitude,
    sourceUrl,
    verifiedAt,
    confidence: "medium",
    planningDurationMinutes: estimateStayMinutes(`${input} ${name}`, placeTypes, 90),
    isAnchor: false,
    placeTypes,
  };
}

export async function fetchGoogleResolvedPlaceCandidates(
  input: string,
  languageCode: "en" | "ja",
  apiKey: string,
  fetcher: typeof fetch = fetch,
  destination: Destination = destinationById("worldwide"),
): Promise<ResolvedInputStop[]> {
  const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": `places.${routeBuildingFieldMask.split(",").join(",places.")}`,
    },
    body: JSON.stringify({
      textQuery: destinationPlaceQuery(input, destination),
      pageSize: 3,
      languageCode,
      ...(destination.regionCode ? { regionCode: destination.regionCode } : {}),
      rankPreference: "RELEVANCE",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as { places?: GooglePlaceSearchResult[] };
  const verifiedAt = new Date().toISOString();
  return (payload.places ?? []).flatMap((place) => {
    const resolved = resolvedPlaceFromGoogle(input, place, destination, verifiedAt);
    return resolved ? [resolved] : [];
  });
}

async function fetchGoogleResolvedPlaceById(
  override: PlaceResolutionProviderOverride,
  languageCode: "en" | "ja",
  apiKey: string,
  fetcher: typeof fetch,
  destination: Destination,
): Promise<ResolvedInputStop | null> {
  let response: Response;
  try {
    response = await fetcher(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(override.providerRef)}?languageCode=${languageCode}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": routeBuildingFieldMask,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let payload: GooglePlaceSearchResult;
  try {
    payload = await response.json() as GooglePlaceSearchResult;
  } catch {
    return null;
  }
  // The exact lookup is an identity check, not permission to accept a
  // different provider result. A stale/deleted choice stays unresolved.
  if (payload.id !== override.providerRef) return null;
  const resolved = resolvedPlaceFromGoogle(override.input, payload, destination, new Date().toISOString());
  return resolved ? { ...resolved, inputIndex: override.inputIndex } : null;
}

export async function fetchGoogleResolvedPlace(
  input: string,
  languageCode: "en" | "ja",
  apiKey: string,
  fetcher: typeof fetch = fetch,
  destination: Destination = destinationById("worldwide"),
): Promise<ResolvedInputStop | null> {
  return (await fetchGoogleResolvedPlaceCandidates(input, languageCode, apiKey, fetcher, destination))[0] ?? null;
}

function needsTravellerChoice(
  input: string,
  candidates: ResolvedInputStop[],
  destinationChoice: DestinationChoice,
) {
  if (candidates.length <= 1) return false;
  const normalized = normalizePlaceName(input);
  if (candidates.filter((candidate) => normalizePlaceName(candidate.name) === normalized).length > 1) return true;

  // In worldwide/auto mode Google relevance alone is not permission to pick a
  // country. Localized or qualified display names can differ even when two
  // candidates represent the same user query, so an exact-name-only check is
  // unsafe. A cross-country shortlist always goes back to the traveller.
  const countries = new Set(candidates.map((candidate) => candidate.countryCode).filter(Boolean));
  if (destinationChoice === "auto" && countries.size > 1) return true;

  // If more than one returned name is a plausible textual match, retain the
  // whole shortlist. A strong first result may still auto-resolve when every
  // alternative is plainly unrelated noise in the already-selected country.
  const plausible = candidates.filter((candidate) => {
    const name = normalizePlaceName(candidate.name);
    return name.includes(normalized) || normalized.includes(name);
  });
  return plausible.length > 1;
}

export async function fetchGooglePlaceResolutions(
  request: PlaceResolutionRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
  const destination = destinationById(request.destination === "auto" ? "worldwide" : request.destination);
  const exactResultsPromise = Promise.all(request.providerOverrides.map((override) => (
    fetchGoogleResolvedPlaceById(override, request.languageCode, apiKey, fetcher, destination)
  )));
  const inputs = [...request.queries, ...(request.hotelQuery ? [request.hotelQuery] : [])];
  const results: ResolvedInputStop[][] = [];
  for (let index = 0; index < inputs.length; index += 6) {
    const group = inputs.slice(index, index + 6);
    results.push(...await Promise.all(group.map((input) => fetchGoogleResolvedPlaceCandidates(input, request.languageCode, apiKey, fetcher, destination))));
  }
  const exactResults = await exactResultsPromise;
  const placeResults = results.slice(0, request.queries.length);
  const ambiguous: AmbiguousPlaceResolution[] = [];
  const places = placeResults.flatMap((candidates, index) => {
    const input = request.queries[index];
    if (needsTravellerChoice(input, candidates, request.destination)) {
      ambiguous.push({ input, candidates: candidates.slice(0, 3) });
      return [];
    }
    return candidates[0] ? [candidates[0]] : [];
  });
  const hotel = request.hotelQuery ? results.at(-1)?.[0] ?? null : null;
  return { places: [...exactResults.filter((stop): stop is ResolvedInputStop => stop !== null), ...places], hotel, ambiguous };
}
