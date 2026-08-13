import { destinationById, isDestinationChoice, type DestinationChoice } from "./destinations.ts";

export type PlaceSuggestionRequest = {
  query: string;
  languageCode: "en" | "ja";
  destination: DestinationChoice;
};

export type PlaceSuggestion = {
  /** Stable Google Place ID. This is the only suggestion field persisted. */
  providerRef: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
};

type GoogleAutocompletePrediction = {
  placeId?: unknown;
  text?: { text?: unknown };
  structuredFormat?: {
    mainText?: { text?: unknown };
    secondaryText?: { text?: unknown };
  };
};

const providerRefPattern = /^[A-Za-z0-9_-]{1,256}$/;

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum
    ? value.trim()
    : null;
}

export function parsePlaceSuggestionRequest(input: unknown): PlaceSuggestionRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const query = boundedText(source.query, 2, 120);
  if (!query || (source.languageCode !== "en" && source.languageCode !== "ja")) return null;
  return {
    query,
    languageCode: source.languageCode,
    destination: isDestinationChoice(source.destination) ? source.destination : "auto",
  };
}

/**
 * Calls Places Autocomplete (New) from the server. In auto mode a worldwide
 * rectangle deliberately replaces Google's implicit caller-IP bias: a person
 * in Japan typing "リンツ" must be offered Linz, Austria rather than only a
 * similarly named nearby shop. A selected country is a hard country filter.
 */
export async function fetchGooglePlaceSuggestions(
  request: PlaceSuggestionRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<PlaceSuggestion[]> {
  const destination = destinationById(request.destination === "auto" ? "worldwide" : request.destination);
  const response = await fetcher("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "suggestions.placePrediction.placeId",
        "suggestions.placePrediction.text.text",
        "suggestions.placePrediction.structuredFormat.mainText.text",
        "suggestions.placePrediction.structuredFormat.secondaryText.text",
      ].join(","),
    },
    body: JSON.stringify({
      input: request.query,
      languageCode: request.languageCode,
      includeQueryPredictions: false,
      includePureServiceAreaBusinesses: false,
      ...(destination.countryCodes.length > 0
        ? {
          includedRegionCodes: destination.countryCodes.map((code) => code.toLocaleLowerCase("en-US")),
          ...(destination.regionCode ? { regionCode: destination.regionCode.toLocaleLowerCase("en-US") } : {}),
        }
        : {
          // Without an explicit bias Google falls back to the request IP.
          // A world-sized rectangle makes worldwide search genuinely neutral.
          locationBias: {
            rectangle: {
              low: { latitude: -89.999, longitude: -180 },
              high: { latitude: 89.999, longitude: 180 },
            },
          },
        }),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("place_suggestions_unavailable");

  const payload = await response.json() as {
    suggestions?: Array<{ placePrediction?: GoogleAutocompletePrediction }>;
  };
  const usedProviderRefs = new Set<string>();
  return (payload.suggestions ?? []).slice(0, 5).flatMap((suggestion) => {
    const prediction = suggestion.placePrediction;
    const providerRef = typeof prediction?.placeId === "string" ? prediction.placeId : "";
    const fullText = boundedText(prediction?.text?.text, 1, 300);
    if (!providerRefPattern.test(providerRef) || usedProviderRefs.has(providerRef) || !fullText) return [];
    usedProviderRefs.add(providerRef);
    const primaryText = boundedText(prediction?.structuredFormat?.mainText?.text, 1, 160)
      ?? fullText.split(",")[0]?.trim()
      ?? fullText;
    const secondaryText = boundedText(prediction?.structuredFormat?.secondaryText?.text, 1, 240)
      ?? fullText.slice(primaryText.length).replace(/^\s*,\s*/, "");
    return [{ providerRef, primaryText, secondaryText, fullText }];
  });
}
