import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFoodSearchPayload,
  foodRecommendationRequestKey,
  foodSlotNeedsRefresh,
  reconcileFoodRecommendationSlots,
} from "../lib/food-recommendations-client.ts";
import {
  defaultFoodDiscoveryQuery,
  extractPaymentEvidence,
  fetchGoogleFoodCandidates,
  foodPopularityScore,
  parseFoodSearchRequest,
  type FoodReviewSnippet,
} from "../lib/google-food.ts";
import type { FoodRecommendationSlot } from "../lib/trip-builder.ts";

const validRequest = {
  latitude: 35.6595,
  longitude: 139.7005,
  area: "Shibuya",
  mealKind: "dinner" as const,
  query: "small-plate izakaya",
  languageCode: "en" as const,
};

const slot: FoodRecommendationSlot = {
  id: "food-1-dinner",
  dayIndex: 0,
  dayLabel: "Day 1",
  date: "2026-09-19",
  kind: "dinner",
  area: "Shibuya",
  anchorStopId: "shibuya",
  latitude: 35.6595,
  longitude: 139.7005,
  window: "17:30–21:00",
  rationale: "Easy to reach.",
  queryIdeas: ["izakaya"],
};

test("accepts legacy food queries and defaults a missing query to local highlights", () => {
  assert.deepEqual(parseFoodSearchRequest(validRequest), validRequest);
  assert.equal(parseFoodSearchRequest({ ...validRequest, latitude: 80 }), null);
  assert.equal(parseFoodSearchRequest({ ...validRequest, languageCode: "ko" }), null);
  assert.equal(parseFoodSearchRequest({ ...validRequest, query: 42 }), null);
  assert.equal(
    parseFoodSearchRequest({ ...validRequest, query: "", languageCode: "ja" })?.query,
    "この土地で今行くべき人気店・名物",
  );
});

test("client can request local highlights without a genre while preserving the legacy signature", () => {
  assert.deepEqual(buildFoodSearchPayload(slot, "ja"), {
    latitude: 35.6595,
    longitude: 139.7005,
    area: "Shibuya",
    mealKind: "dinner",
    query: defaultFoodDiscoveryQuery("ja"),
    languageCode: "ja",
    visitDate: "2026-09-19",
    visitTime: "19:00",
  });
  assert.deepEqual(buildFoodSearchPayload(slot, "izakaya", "en"), {
    latitude: 35.6595,
    longitude: 139.7005,
    area: "Shibuya",
    mealKind: "dinner",
    query: "izakaya",
    languageCode: "en",
    visitDate: "2026-09-19",
    visitTime: "19:00",
  });
});

test("reuses a meal search for a nearby final anchor but refreshes material moves and date changes", () => {
  const nearby = { ...slot, latitude: slot.latitude + 0.001 };
  const moved = { ...slot, latitude: slot.latitude + 0.01 };
  const nextDate = { ...slot, date: "2026-09-20" };

  assert.equal(foodSlotNeedsRefresh(slot, nearby), false);
  assert.equal(foodSlotNeedsRefresh(slot, moved), true);
  assert.equal(foodSlotNeedsRefresh(slot, nextDate), true);
  assert.equal(foodRecommendationRequestKey(slot, "en"), foodRecommendationRequestKey({ ...slot }, "en"));
});

test("reconciles final meal slots by stable id and drops slots no longer displayed", () => {
  const lunch = { ...slot, id: "food-1-lunch", kind: "lunch" as const };
  const finalDinner = { ...slot, latitude: slot.latitude + 0.01 };
  const newLunch = { ...lunch, id: "food-2-lunch", dayIndex: 1, date: "2026-09-20" };
  const result = reconcileFoodRecommendationSlots([slot, lunch], [finalDinner, newLunch]);

  assert.deepEqual(result.refresh.map(({ id }) => id), ["food-1-dinner", "food-2-lunch"]);
  assert.deepEqual(result.reuse, []);
  assert.deepEqual(result.droppedIds, ["food-1-lunch"]);
});

test("local highlights use Nearby popularity, collect rich evidence, and return only the deterministic top three", async () => {
  const captured: { value: { url: string; init: RequestInit } | null } = { value: null };
  const makePlace = (
    id: string,
    rating: number,
    userRatingCount: number,
    openNow: boolean | undefined,
    latitudeOffset: number,
    businessStatus = "OPERATIONAL",
  ) => ({
    id,
    displayName: { text: `Restaurant ${id}` },
    formattedAddress: `${id} Shibuya, Tokyo`,
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    websiteUri: `https://${id}.example.com`,
    businessStatus,
    primaryTypeDisplayName: { text: "Restaurant" },
    rating,
    userRatingCount,
    location: { latitude: validRequest.latitude + latitudeOffset, longitude: validRequest.longitude },
    currentOpeningHours: { openNow, weekdayDescriptions: ["Monday: 11:00–22:00"] },
    photos: [{
      name: `places/${id}/photos/1`,
      googleMapsUri: `https://maps.google.com/photo/${id}`,
      authorAttributions: [{ displayName: "Photographer", uri: "https://maps.google.com/contrib/photo" }],
    }],
    reviews: [{
      rating: 5,
      text: { text: "Credit cards accepted and PayPay worked." },
      publishTime: "2026-07-18T01:00:00Z",
      relativePublishTimeDescription: "3 days ago",
      authorAttribution: {
        displayName: "A guest",
        uri: `https://maps.google.com/contrib/${id}`,
        photoUri: `https://lh3.googleusercontent.com/${id}`,
      },
      googleMapsUri: `https://maps.google.com/review/${id}`,
    }],
  });
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.value = { url: String(url), init: init ?? {} };
    return Response.json({ places: [
      { ...makePlace("popular", 4.5, 1_000, true, 0.001), paymentOptions: { acceptsCashOnly: true, acceptsCreditCards: true } },
      makePlace("tiny-sample", 5, 3, true, 0.001),
      makePlace("closed-now", 4.6, 800, false, 0.002),
      makePlace("steady", 4.2, 300, undefined, 0.0015),
      makePlace("permanently-closed", 5, 10_000, true, 0.0001, "CLOSED_PERMANENTLY"),
    ] });
  }) as typeof fetch;

  const request = {
    ...validRequest,
    query: defaultFoodDiscoveryQuery("en"),
  };
  const results = await fetchGoogleFoodCandidates(request, "secret", fetcher);

  assert.equal(captured.value?.url, "https://places.googleapis.com/v1/places:searchNearby");
  const headers = captured.value?.init.headers as Record<string, string>;
  assert.match(headers["X-Goog-FieldMask"], /places\.rating/);
  assert.match(headers["X-Goog-FieldMask"], /places\.userRatingCount/);
  assert.match(headers["X-Goog-FieldMask"], /places\.paymentOptions/);
  assert.match(headers["X-Goog-FieldMask"], /places\.reviews/);
  assert.match(headers["X-Goog-FieldMask"], /places\.websiteUri/);
  const body = JSON.parse(String(captured.value?.init.body));
  assert.equal(body.rankPreference, "POPULARITY");
  assert.deepEqual(body.includedTypes, ["restaurant"]);
  assert.equal(body.maxResultCount, 10);
  assert.equal(body.locationRestriction.circle.radius, 1_500);

  assert.deepEqual(results.map(({ id }) => id), ["closed-now", "popular", "steady"]);
  const popular = results.find(({ id }) => id === "popular");
  assert.equal(popular?.rating, 4.5);
  assert.equal(popular?.userRatingCount, 1_000);
  assert.equal(popular?.openNow, true);
  assert.deepEqual(popular?.hours, ["Monday: 11:00–22:00"]);
  assert.equal(popular?.websiteUrl, "https://popular.example.com");
  assert.equal(popular?.reviewSnippets[0].googleMapsUrl, "https://maps.google.com/review/popular");
  assert.equal(popular?.reviewSnippets[0].authorPhotoUri, "https://lh3.googleusercontent.com/popular");
  assert.equal(popular?.photoGoogleMapsUrl, "https://maps.google.com/photo/popular");
  assert.equal(popular?.paymentEvidence.some(({ kind }) => kind === "cash_only"), false);
  assert.equal(popular?.paymentEvidence.some(({ kind, accepted }) => kind === "cards" && accepted), true);
  assert.equal(popular?.paymentEvidence.some(({ kind, accepted }) => kind === "qr" && accepted), true);
});

test("an explicit legacy cuisine query still uses bounded Text Search", async () => {
  const captured: { value: { url: string; init: RequestInit } | null } = { value: null };
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.value = { url: String(url), init: init ?? {} };
    return Response.json({ places: [] });
  }) as typeof fetch;

  await fetchGoogleFoodCandidates(validRequest, "secret", fetcher);
  assert.equal(captured.value?.url, "https://places.googleapis.com/v1/places:searchText");
  const body = JSON.parse(String(captured.value?.init.body));
  assert.equal(body.textQuery, "small-plate izakaya Shibuya");
  assert.equal(body.pageSize, 8);
  assert.equal(body.includedType, "restaurant");
  assert.equal(body.locationBias.circle.radius, 1_500);
  assert.equal(JSON.stringify(body).includes("itinerary"), false);
});

test("filters restaurants that are explicitly closed at the planned meal time", async () => {
  const place = (id: string, openHour: number, closeHour: number) => ({
    id,
    displayName: { text: id },
    formattedAddress: "Shibuya, Tokyo",
    googleMapsUri: `https://maps.google.com/${id}`,
    businessStatus: "OPERATIONAL",
    rating: 4.5,
    userRatingCount: 500,
    location: { latitude: validRequest.latitude, longitude: validRequest.longitude },
    regularOpeningHours: { periods: [{
      open: { day: 6, hour: openHour, minute: 0 },
      close: { day: 6, hour: closeHour, minute: 0 },
    }] },
  });
  const fetcher = (async () => Response.json({ places: [
    place("dinner-open", 17, 22),
    place("lunch-only", 11, 15),
  ] })) as typeof fetch;
  const results = await fetchGoogleFoodCandidates({
    ...validRequest,
    query: defaultFoodDiscoveryQuery("en"),
    visitDate: "2026-09-19",
    visitTime: "19:00",
  }, "secret", fetcher);

  assert.deepEqual(results.map(({ id }) => id), ["dinner-open"]);
  assert.equal(results[0].plannedOpen, true);
});

test("payment evidence uses explicit review wording and never claims cash-only beside another true method", () => {
  const review = (text: string, url: string): FoodReviewSnippet => ({
    rating: 4,
    text,
    publishedAt: "2026-07-18T01:00:00Z",
    relativeTime: "3日前",
    authorName: "利用者",
    authorUri: null,
    authorPhotoUri: null,
    googleMapsUrl: url,
  });

  const cashEvidence = extractPaymentEvidence(
    undefined,
    [review("支払いは現金のみでした。", "https://maps.google.com/review/cash")],
    "ja",
  );
  assert.equal(cashEvidence[0].kind, "cash_only");
  assert.equal(cashEvidence[0].source, "review");
  assert.equal(cashEvidence[0].sourceUrl, "https://maps.google.com/review/cash");

  const conflicting = extractPaymentEvidence(
    { acceptsCashOnly: true, acceptsCreditCards: true },
    [review("以前は現金のみでした。", "https://maps.google.com/review/old")],
    "ja",
  );
  assert.equal(conflicting.some(({ kind }) => kind === "cash_only"), false);
  assert.equal(conflicting.some(({ kind }) => kind === "cards"), true);
});

test("payment evidence distinguishes rejected methods, does not infer cash-only, and drops conflicts", () => {
  const review = (text: string): FoodReviewSnippet => ({
    rating: 4,
    text,
    publishedAt: "2026-07-18T01:00:00Z",
    relativeTime: "3日前",
    authorName: "利用者",
    authorUri: null,
    authorPhotoUri: null,
    googleMapsUrl: "https://maps.google.com/review/payment",
  });
  const evidence = extractPaymentEvidence(undefined, [
    review("カードは使えません。"),
    review("PayPayも利用不可でした。"),
    review("Suicaで支払えました。"),
  ], "ja");
  assert.equal(evidence.some(({ kind }) => kind === "cash_only"), false);
  assert.equal(evidence.some(({ kind, accepted }) => kind === "cards" && !accepted), true);
  assert.equal(evidence.some(({ kind, accepted }) => kind === "qr" && !accepted), true);
  assert.equal(evidence.some(({ kind, accepted }) => kind === "transport_ic" && accepted), true);

  const englishNegative = extractPaymentEvidence(undefined, [review("PayPay was not accepted.")], "en");
  assert.equal(englishNegative.some(({ kind, accepted }) => kind === "qr" && !accepted), true);
  assert.equal(englishNegative.some(({ kind, accepted }) => kind === "qr" && accepted), false);

  const conflict = extractPaymentEvidence(
    { acceptsCreditCards: true },
    [review("カードは使えませんでした。")],
    "ja",
  );
  assert.equal(conflict.some(({ kind }) => kind === "cards"), false);
});

test("open-now state never changes future-meal popularity scoring", () => {
  const common = { rating: 4.4, userRatingCount: 800, distanceMeters: 300 };
  assert.equal(
    foodPopularityScore({ ...common, openNow: true }),
    foodPopularityScore({ ...common, openNow: false }),
  );
});

test("composes the one-line food reason only from returned Google evidence", async () => {
  const { foodCandidateReason } = await import("../lib/food-recommendations-client.ts");
  const base = {
    id: "food-1",
    name: "Sample Diner",
    address: "1-2-3 Sample, Tokyo",
    type: "Japanese restaurant",
    googleMapsUrl: "https://maps.google.com/sample-diner",
    distanceMeters: 400,
    rating: 4.6,
    userRatingCount: 1800,
    openNow: null,
    plannedOpen: true,
    hours: [],
    businessStatus: "OPERATIONAL",
    paymentEvidence: [],
    reviewSnippets: [],
    websiteUrl: null,
  };

  const ja = foodCandidateReason(base, "ja");
  assert.match(ja, /★4\.6・口コミ1,800件/);
  assert.match(ja, /徒歩約5分/);
  assert.doesNotMatch(ja, /名物|人気/);
  assert.ok(ja.endsWith("。"));

  const en = foodCandidateReason(base, "en");
  assert.match(en, /★4\.6 across 1,800 reviews/);
  assert.ok(/^[A-Z]/.test(en));

  const bare = foodCandidateReason({ ...base, rating: null, userRatingCount: null, distanceMeters: null, plannedOpen: null }, "ja");
  assert.equal(bare, base.address);
});
