export type FoodSearchRequest = {
  latitude: number;
  longitude: number;
  area: string;
  mealKind: "lunch" | "dinner";
  query: string;
  languageCode: "en" | "ja";
};

export type FoodCandidate = {
  id: string;
  name: string;
  address: string;
  type: string;
  googleMapsUrl: string;
};

const validLanguages = new Set(["en", "ja"]);
const validMealKinds = new Set(["lunch", "dinner"]);

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

export function parseFoodSearchRequest(input: unknown): FoodSearchRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.latitude !== "number" || !Number.isFinite(candidate.latitude) || candidate.latitude < 20 || candidate.latitude > 46) return null;
  if (typeof candidate.longitude !== "number" || !Number.isFinite(candidate.longitude) || candidate.longitude < 122 || candidate.longitude > 154) return null;
  if (typeof candidate.languageCode !== "string" || !validLanguages.has(candidate.languageCode)) return null;
  if (typeof candidate.mealKind !== "string" || !validMealKinds.has(candidate.mealKind)) return null;
  const area = boundedText(candidate.area, 1, 80);
  const query = boundedText(candidate.query, 1, 120);
  if (!area || !query) return null;
  return {
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    area,
    mealKind: candidate.mealKind as FoodSearchRequest["mealKind"],
    query,
    languageCode: candidate.languageCode as FoodSearchRequest["languageCode"],
  };
}

export async function fetchGoogleFoodCandidates(
  request: FoodSearchRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<FoodCandidate[]> {
  const response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.primaryTypeDisplayName",
    },
    body: JSON.stringify({
      textQuery: `${request.query} ${request.area}`,
      includedType: "restaurant",
      strictTypeFiltering: true,
      pageSize: 4,
      languageCode: request.languageCode,
      regionCode: "JP",
      rankPreference: "RELEVANCE",
      locationBias: {
        circle: {
          center: { latitude: request.latitude, longitude: request.longitude },
          radius: 1500,
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("places_unavailable");
  const payload = await response.json() as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      googleMapsUri?: string;
      primaryTypeDisplayName?: { text?: string };
    }>;
  };
  return (payload.places ?? []).flatMap((place) => {
    const name = place.displayName?.text?.trim();
    const googleMapsUrl = place.googleMapsUri?.trim();
    if (!place.id || !name || !googleMapsUrl) return [];
    return [{
      id: place.id,
      name,
      address: place.formattedAddress?.trim() ?? "",
      type: place.primaryTypeDisplayName?.text?.trim() ?? "Restaurant",
      googleMapsUrl,
    }];
  }).slice(0, 4);
}
