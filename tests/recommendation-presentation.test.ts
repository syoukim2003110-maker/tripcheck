import assert from "node:assert/strict";
import test from "node:test";

import {
  gapEnhancement,
  hotelEnhancement,
  mealEnhancement,
  type Enhancement,
} from "../lib/presentation/recommendation-presentation.ts";
import type { FoodCandidate } from "../lib/google-food.ts";
import type { HotelCandidate } from "../lib/google-hotels.ts";
import type { RouteRecommendation } from "../lib/route-recommendations.ts";

function routeCandidate(overrides: Partial<RouteRecommendation> = {}): RouteRecommendation {
  return {
    id: "google-rec-1",
    providerRef: "rec-1",
    name: "Blue Bottle Kiyosumi",
    address: "Koto City",
    type: "Cafe",
    placeTypes: ["cafe", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: null,
    googleMapsUrl: "https://maps.google.com/?q=rec-1",
    latitude: 35.68,
    longitude: 139.8,
    rating: 4.4,
    userRatingCount: 2100,
    routeDistanceMeters: 240,
    photoName: null,
    photoAttribution: null,
    ...overrides,
  };
}

function hotelCandidate(overrides: Partial<HotelCandidate> = {}): HotelCandidate {
  return {
    id: "hotel-1",
    name: "Hotel Andaz",
    address: "Toranomon",
    googleMapsUrl: "https://maps.google.com/?q=hotel-1",
    websiteUrl: null,
    latitude: 35.66,
    longitude: 139.74,
    rating: 4.6,
    userRatingCount: 3200,
    distanceMeters: 500,
    routeAverageDistanceMeters: 900,
    routeWorstDistanceMeters: 1400,
    routeBurdenMeters: 1050,
    score: 88,
    googleRelevanceRank: 1,
    priceLevel: null,
    styles: [],
    photo: null,
    reviews: null,
    payment: null,
    rakuten: null,
    ...overrides,
  };
}

function foodCandidate(overrides: Partial<FoodCandidate> = {}): FoodCandidate {
  return {
    id: "food-1",
    name: "Afuri Ramen",
    address: "Ebisu",
    type: "Ramen restaurant",
    googleMapsUrl: "https://maps.google.com/?q=food-1",
    distanceMeters: 300,
    rating: 4.2,
    userRatingCount: 5400,
    openNow: true,
    plannedOpen: null,
    hours: [],
    businessStatus: "OPERATIONAL",
    paymentEvidence: [],
    reviewSnippets: [],
    websiteUrl: null,
    ...overrides,
  };
}

test("gapEnhancement classifies cafe-like places as CAFE and the rest as MICRO_STOP", () => {
  assert.equal(gapEnhancement(routeCandidate()).type, "CAFE");
  assert.equal(gapEnhancement(routeCandidate({ placeTypes: ["bakery"] })).type, "CAFE");
  assert.equal(gapEnhancement(routeCandidate({ placeTypes: ["coffee_shop"] })).type, "CAFE");
  assert.equal(gapEnhancement(routeCandidate({ placeTypes: ["tea_house"] })).type, "CAFE");
  assert.equal(gapEnhancement(routeCandidate({ placeTypes: ["park", "tourist_attraction"] })).type, "MICRO_STOP");
  assert.equal(gapEnhancement(routeCandidate({ placeTypes: [] })).type, "MICRO_STOP");
});

test("gapEnhancement keeps identity and clamps the added-minute impact", () => {
  const enhancement = gapEnhancement(routeCandidate(), { addedMinutes: 18.4, reason: "fits the gap" });
  assert.equal(enhancement.id, "google-rec-1");
  assert.equal(enhancement.title, "Blue Bottle Kiyosumi");
  assert.equal(enhancement.reason, "fits the gap");
  assert.deepEqual(enhancement.impact, { addedMinutes: 18, savedMinutes: 0 });

  assert.equal(gapEnhancement(routeCandidate(), { addedMinutes: -12 }).impact.addedMinutes, 0);
  assert.equal(gapEnhancement(routeCandidate(), { addedMinutes: Number.NaN }).impact.addedMinutes, 0);
  assert.equal(gapEnhancement(routeCandidate(), { addedMinutes: Number.POSITIVE_INFINITY }).impact.addedMinutes, 0);
  assert.equal(gapEnhancement(routeCandidate(), { addedMinutes: null }).impact.addedMinutes, 0);
  assert.equal(gapEnhancement(routeCandidate()).impact.addedMinutes, 0);
});

test("gapEnhancement assembles the gap card's rating and detour lines verbatim", () => {
  const full = gapEnhancement(routeCandidate());
  assert.deepEqual(full.evidence, ["★ 4.4 · 2,100", "About 240m from the route"]);

  const bare = gapEnhancement(routeCandidate({ rating: null, userRatingCount: null }));
  assert.deepEqual(bare.evidence, ["About 240m from the route"]);

  const noCount = gapEnhancement(routeCandidate({ userRatingCount: null }));
  assert.deepEqual(noCount.evidence, ["★ 4.4 · —", "About 240m from the route"]);

  const ja = gapEnhancement(routeCandidate(), { locale: "ja" });
  assert.deepEqual(ja.evidence, ["★ 4.4 · 2,100", "予定経路から約240m"]);
});

test("hotelEnhancement reports saved minutes from the travel delta and defaults to 0", () => {
  const withDelta = hotelEnhancement(hotelCandidate(), { travelMinutes: 22.6, note: "least travel" });
  assert.equal(withDelta.type, "HOTEL");
  assert.equal(withDelta.title, "Hotel Andaz");
  assert.equal(withDelta.reason, "least travel");
  assert.deepEqual(withDelta.impact, { addedMinutes: 0, savedMinutes: 23 });

  assert.equal(hotelEnhancement(hotelCandidate()).impact.savedMinutes, 0);
  assert.equal(hotelEnhancement(hotelCandidate(), { travelMinutes: null }).impact.savedMinutes, 0);
  assert.equal(hotelEnhancement(hotelCandidate(), { travelMinutes: -40 }).impact.savedMinutes, 0);
  assert.equal(hotelEnhancement(hotelCandidate(), { travelMinutes: Number.NaN }).impact.savedMinutes, 0);
});

test("hotelEnhancement folds the comparison list's Google and Rakuten fact lines into evidence", () => {
  const enhancement = hotelEnhancement(hotelCandidate({
    rakuten: { minCharge: 18000, reviewAverage: 4.3, reviewCount: 812, url: "https://travel.rakuten.co.jp/x" },
  }));
  assert.deepEqual(enhancement.evidence, ["★ 4.6 (3,200)", "Rakuten Travel ★4.3 (812)", "¥18,000〜"]);

  const ja = hotelEnhancement(hotelCandidate({
    rakuten: { minCharge: 18000, reviewAverage: 4.3, reviewCount: 812, url: "https://travel.rakuten.co.jp/x" },
  }), { locale: "ja" });
  assert.deepEqual(ja.evidence, ["★ 4.6（3,200）", "楽天トラベル ★4.3（812件）", "¥18,000〜"]);

  const noFacts = hotelEnhancement(hotelCandidate({ rating: null, userRatingCount: null }));
  assert.deepEqual(noFacts.evidence, []);

  // A Rakuten review with no count renders (0), exactly as the card does.
  const partialRakuten = hotelEnhancement(hotelCandidate({
    rating: null,
    rakuten: { minCharge: null, reviewAverage: 4.1, reviewCount: null, url: "https://travel.rakuten.co.jp/y" },
  }));
  assert.deepEqual(partialRakuten.evidence, ["Rakuten Travel ★4.1 (0)"]);
});

test("mealEnhancement carries the slot kind in its id and clamps the detour", () => {
  const lunch = mealEnhancement(foodCandidate(), { slotKind: "lunch", detourMinutes: 7.2, reason: "on the way" });
  assert.equal(lunch.type, "MEAL");
  assert.equal(lunch.id, "meal:lunch:food-1");
  assert.equal(lunch.reason, "on the way");
  assert.deepEqual(lunch.impact, { addedMinutes: 7, savedMinutes: 0 });

  const dinner = mealEnhancement(foodCandidate(), { slotKind: "dinner" });
  assert.equal(dinner.id, "meal:dinner:food-1");
  assert.deepEqual(dinner.impact, { addedMinutes: 0, savedMinutes: 0 });
  assert.equal(mealEnhancement(foodCandidate(), { slotKind: "dinner", detourMinutes: -3 }).impact.addedMinutes, 0);
});

test("mealEnhancement prefers planned-open evidence over open-now and includes payment", () => {
  const planned = mealEnhancement(foodCandidate({ plannedOpen: true }), { slotKind: "lunch" });
  assert.deepEqual(planned.evidence, ["★ 4.2 · 5,400", "Open for this meal time"]);

  const openNow = mealEnhancement(foodCandidate(), { slotKind: "lunch" });
  assert.deepEqual(openNow.evidence, ["★ 4.2 · 5,400", "Listed open now"]);

  const ja = mealEnhancement(foodCandidate({ plannedOpen: true }), { slotKind: "lunch", locale: "ja" });
  assert.deepEqual(ja.evidence, ["★ 4.2 · 5,400", "食事時間に営業予定"]);

  const withPayment = mealEnhancement(foodCandidate({
    rating: null,
    openNow: null,
    paymentEvidence: [{ kind: "cards", accepted: true, label: "Cards accepted", evidence: "listing", source: "listing", sourceUrl: null }],
  }), { slotKind: "dinner" });
  assert.deepEqual(withPayment.evidence, ["Cards accepted"]);
});

test("builders never throw on minimal or partial input", () => {
  const minimalRoute = { id: "r", name: "" } as unknown as RouteRecommendation;
  const minimalHotel = { id: "h", name: "" } as unknown as HotelCandidate;
  const minimalFood = { id: "f", name: "" } as unknown as FoodCandidate;

  let gap: Enhancement | null = null;
  let hotel: Enhancement | null = null;
  let meal: Enhancement | null = null;
  assert.doesNotThrow(() => { gap = gapEnhancement(minimalRoute); });
  assert.doesNotThrow(() => { hotel = hotelEnhancement(minimalHotel); });
  assert.doesNotThrow(() => { meal = mealEnhancement(minimalFood, { slotKind: "lunch" }); });

  assert.equal(gap!.type, "MICRO_STOP");
  assert.deepEqual(gap!.impact, { addedMinutes: 0, savedMinutes: 0 });
  assert.deepEqual(gap!.evidence, []);
  assert.equal(hotel!.type, "HOTEL");
  assert.deepEqual(hotel!.evidence, []);
  assert.equal(meal!.type, "MEAL");
  assert.equal(meal!.reason, "");
  assert.deepEqual(meal!.evidence, []);
});
