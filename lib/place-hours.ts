import type { PlaceIntelligenceResult } from "./place-intelligence.ts";
import type { RouteStop } from "./route-optimizer.ts";

const noOpeningHoursPlaceTypes = new Set([
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "geocode",
  "locality",
  "mountain_peak",
  "natural_feature",
  "neighborhood",
  "postal_code",
  "sublocality",
]);

/** Geographic areas and natural features do not have business opening hours. */
export function placeRequiresOpeningHours(stop: Pick<RouteStop, "placeTypes" | "openingHoursApplicable">) {
  if (stop.openingHoursApplicable === false) return false;
  return !(stop.placeTypes ?? []).some((type) => noOpeningHoursPlaceTypes.has(type));
}

/** True only when Google actually returned an hours/closure fact. */
export function placeHasOpeningHoursEvidence(place: PlaceIntelligenceResult["place"]) {
  return place.hours.length > 0
    || (Array.isArray(place.currentOpeningPeriods) && place.currentOpeningPeriods.length > 0)
    || (Array.isArray(place.regularOpeningPeriods) && place.regularOpeningPeriods.length > 0)
    || place.businessStatus === "CLOSED_PERMANENTLY"
    || place.businessStatus === "CLOSED_TEMPORARILY";
}
