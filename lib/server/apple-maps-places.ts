import type { MapsPlaceSearch } from "../open-place-resolver.ts";
import { appleMapsClient, type AppleMapsClient } from "./apple-maps.ts";

/**
 * Apple Maps as the open resolver's optional maps search. Returns null when
 * the deployment has no Apple credentials, so the resolver runs on open data
 * alone exactly as before.
 */
export function appleMapsPlaceSearch(client: AppleMapsClient | null = appleMapsClient()): MapsPlaceSearch | null {
  if (!client) return null;
  return async (input, languageCode, near, signal) => {
    const places = await client.search({
      query: input,
      language: languageCode === "ja" ? "ja-JP" : "en-US",
      near,
      signal,
    });
    return places.map((place) => ({
      id: place.id,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.formattedAddress,
      area: place.subLocality ?? place.locality,
      countryCode: place.countryCode,
      category: place.poiCategory,
    }));
  };
}
