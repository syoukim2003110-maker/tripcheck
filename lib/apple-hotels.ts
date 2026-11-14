import type { HotelCandidate, HotelSearchRequest } from "./google-hotels.ts";

/*
 * Hotel candidates from Apple Maps. Apple returns places, not ratings or
 * prices, so the comparison here is the one thing that can be computed
 * honestly from a coordinate: how little each hotel makes the trip travel.
 * Every day's route centre gets one equal vote; the burden is 70% the average
 * distance and 30% the worst day, the same metric the rated ranking uses.
 */

type AppleHotelPlace = Readonly<{
  id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  poiCategory: string | null;
}>;

type AppleHotelSearch = {
  search(options: {
    query: string;
    language: string;
    near: { latitude: number; longitude: number };
    withinMeters: number;
    poiCategories: readonly string[];
    poiOnly: boolean;
    signal?: AbortSignal;
  }): Promise<AppleHotelPlace[]>;
};

const NEAR_METERS = 2_500;
const WIDE_METERS = 5_000;

function distanceMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(toLatitude - fromLatitude) / 2) ** 2
    + Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) * Math.sin(radians(toLongitude - fromLongitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export async function fetchAppleHotelCandidates(
  request: HotelSearchRequest,
  client: AppleHotelSearch,
  signal?: AbortSignal,
): Promise<HotelCandidate[]> {
  const typed = request.query?.trim();
  const search = (query: string, withinMeters: number) => client.search({
    query,
    language: request.languageCode === "ja" ? "ja-JP" : "en-US",
    near: { latitude: request.latitude, longitude: request.longitude },
    withinMeters,
    poiCategories: ["Hotel"],
    poiOnly: true,
    signal,
  });
  const generic = request.languageCode === "ja" ? "ホテル" : "hotel";
  let places = await search(typed || generic, typed ? WIDE_METERS : NEAR_METERS);
  // A resort area or a quiet town has few hotels inside a short walk.
  if (!typed && places.length < 5) places = [...places, ...await search(generic, WIDE_METERS)];

  const seen = new Set<string>();
  const candidates = places.flatMap((place, index): HotelCandidate[] => {
    const coordinate = `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`;
    const key = `${place.name.normalize("NFKC").toLocaleLowerCase()}@${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `apple-${place.id ?? coordinate}`.slice(0, 300),
      name: place.name,
      address: place.formattedAddress,
      // The card's outbound link: the same hotel in a maps app, where the
      // traveller can see the price, rating and availability Apple omits.
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${coordinate}`)}`,
      websiteUrl: null,
      latitude: place.latitude,
      longitude: place.longitude,
      rating: null,
      userRatingCount: null,
      distanceMeters: Math.round(distanceMeters(request.latitude, request.longitude, place.latitude, place.longitude)),
      // Filled in by the ranking below.
      routeAverageDistanceMeters: 0,
      routeWorstDistanceMeters: 0,
      routeBurdenMeters: 0,
      score: 0,
      googleRelevanceRank: index + 1,
      priceLevel: null,
      styles: [],
      photo: null,
      reviews: null,
      payment: null,
      rakuten: null,
    }];
  });
  const routePoints = request.routePoints?.length
    ? request.routePoints
    : [{ latitude: request.latitude, longitude: request.longitude }];
  return rerankHotelCandidates(candidates, routePoints).slice(0, 5);
}

/**
 * The same hotels measured against the days as they are now, nearest to the
 * whole trip first. No search is made: after the places of a trip move, the
 * hotels already found are ranked again, so the order and the distance shown
 * are never those of an earlier plan.
 */
export function rerankHotelCandidates(
  candidates: readonly HotelCandidate[],
  routePoints: ReadonlyArray<{ latitude: number; longitude: number }>,
): HotelCandidate[] {
  if (routePoints.length === 0) return [...candidates];
  return candidates.map((candidate) => {
    const distances = routePoints.map((point) => distanceMeters(point.latitude, point.longitude, candidate.latitude, candidate.longitude));
    const average = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    const worst = Math.max(...distances);
    const burden = 0.7 * average + 0.3 * worst;
    return {
      ...candidate,
      routeAverageDistanceMeters: Math.round(average),
      routeWorstDistanceMeters: Math.round(worst),
      routeBurdenMeters: Math.round(burden),
      // Closer to the whole trip scores higher; nothing else is known.
      score: Math.round(Math.max(0, 100 - burden / 100) * 100) / 100,
    };
  }).sort((left, right) => left.routeBurdenMeters - right.routeBurdenMeters || left.name.localeCompare(right.name));
}
