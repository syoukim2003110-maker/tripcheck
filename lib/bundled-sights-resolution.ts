import { destinationForCoordinate } from "./destinations.ts";
import { placeTypesFromKinds } from "./open-place-resolver.ts";
import { bundledSightIndex, type PopularDestination } from "./popular-sights.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import { estimateStayMinutes } from "./stay-estimates.ts";

/*
 * Places a wishlist line without the network when it is exactly one of the
 * bundled sights — which is what every line added from the destination picker
 * is. Those lines then cost no lookup, cannot fail when a public service is
 * slow, and cannot be confused with a namesake. Anything else, and any name
 * that means more than one bundled place, goes through the normal lookup.
 */
export function knownStopsForQueries(
  queries: readonly string[],
  languageCode: "en" | "ja",
  data: { generatedAt?: string; cities: readonly PopularDestination[] },
): Map<string, ResolvedInputStop> {
  const index = bundledSightIndex(data.cities);
  const verifiedAt = /^\d{4}-\d{2}-\d{2}$/.test(data.generatedAt ?? "")
    ? `${data.generatedAt}T00:00:00.000Z`
    : new Date(0).toISOString();
  const known = new Map<string, ResolvedInputStop>();
  for (const query of queries) {
    const match = index.find(query);
    if (!match) continue;
    const { sight, destination } = match;
    const name = (languageCode === "ja" ? sight.ja : sight.en).trim();
    const area = (languageCode === "ja" ? destination.ja : destination.en).trim();
    const placeTypes = placeTypesFromKinds([sight.kind]);
    const profile = destinationForCoordinate(sight.lat, sight.lon);
    const countryCode = profile && profile.countryCodes.length === 1 ? profile.countryCodes[0] : undefined;
    known.set(query, {
      id: `wikidata-${sight.q}`,
      input: query,
      name,
      area,
      address: area,
      ...(countryCode ? { countryCode } : {}),
      latitude: sight.lat,
      longitude: sight.lon,
      sourceUrl: `https://www.wikidata.org/wiki/${sight.q}`,
      verifiedAt,
      confidence: "medium",
      planningDurationMinutes: estimateStayMinutes(`${query} ${name}`, placeTypes, 90),
      isAnchor: false,
      placeTypes,
    });
  }
  return known;
}
