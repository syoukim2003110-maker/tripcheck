import type { ResolvedInputStop } from "./route-optimizer.ts";

export type PlaceResolutionRequest = {
  queries: string[];
  hotelQuery: string | null;
  languageCode: "en" | "ja";
};

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

export function parsePlaceResolutionRequest(input: unknown): PlaceResolutionRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (candidate.languageCode !== "en" && candidate.languageCode !== "ja") return null;
  if (!Array.isArray(candidate.queries) || candidate.queries.length > 24) return null;
  const queries = candidate.queries.map((query) => boundedText(query, 1, 120));
  if (queries.some((query) => query === null)) return null;
  const hotelQuery = candidate.hotelQuery === null || candidate.hotelQuery === ""
    ? null
    : boundedText(candidate.hotelQuery, 1, 120);
  if (candidate.hotelQuery && !hotelQuery) return null;
  return {
    queries: [...new Set(queries as string[])],
    hotelQuery,
    languageCode: candidate.languageCode,
  };
}

function areaFromAddress(address: string, fallback: string) {
  const prefecture = address.match(/北海道|東京都|(?:京都|大阪)府|[\p{Script=Han}]{2,3}県/u);
  if (prefecture) {
    const following = address.slice((prefecture.index ?? 0) + prefecture[0].length);
    const municipality = following.match(/^[^\s,、市区町村]{1,8}[市区町村]/)?.[0] ?? "";
    return `${prefecture[0]}${municipality}`;
  }
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const useful = parts.filter((part) => !/^(?:japan|〒?\d{3}-?\d{4})$/i.test(part));
  return useful.at(-2) ?? useful.at(-1) ?? fallback;
}

export async function fetchGoogleResolvedPlace(
  input: string,
  languageCode: "en" | "ja",
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedInputStop | null> {
  const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri",
    },
    body: JSON.stringify({
      textQuery: `${input} Japan`,
      pageSize: 1,
      languageCode,
      regionCode: "JP",
      rankPreference: "RELEVANCE",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      googleMapsUri?: string;
    }>;
  };
  const place = payload.places?.[0];
  const name = place?.displayName?.text?.trim();
  const address = place?.formattedAddress?.trim() ?? "";
  const latitude = place?.location?.latitude;
  const longitude = place?.location?.longitude;
  const sourceUrl = place?.googleMapsUri?.trim();
  if (!place?.id || !name || !sourceUrl || typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (latitude < 20 || latitude > 46 || longitude < 122 || longitude > 154) return null;
  return {
    id: `google-${place.id}`,
    input,
    name,
    area: areaFromAddress(address, name),
    address,
    latitude,
    longitude,
    sourceUrl,
    verifiedAt: new Date().toISOString(),
    confidence: "medium",
    planningDurationMinutes: 90,
    isAnchor: false,
  };
}

export async function fetchGooglePlaceResolutions(
  request: PlaceResolutionRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
  const inputs = [...request.queries, ...(request.hotelQuery ? [request.hotelQuery] : [])];
  const results: Array<ResolvedInputStop | null> = [];
  for (let index = 0; index < inputs.length; index += 6) {
    const group = inputs.slice(index, index + 6);
    results.push(...await Promise.all(group.map((input) => fetchGoogleResolvedPlace(input, request.languageCode, apiKey, fetcher))));
  }
  const places = results.slice(0, request.queries.length).filter((place): place is ResolvedInputStop => place !== null);
  const hotel = request.hotelQuery ? results.at(-1) ?? null : null;
  return { places, hotel };
}
