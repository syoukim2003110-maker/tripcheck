import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHotelSearchPayload,
  HotelRecommendationsError,
  requestHotelRecommendations,
} from "../lib/hotel-recommendations-client.ts";
import { fetchGoogleHotelCandidates, hotelStyles, parseHotelSearchRequest } from "../lib/google-hotels.ts";

const validRequest = {
  latitude: 35.6812,
  longitude: 139.7671,
  area: "Tokyo Station",
  languageCode: "en" as const,
};

test("accepts a bounded hotel search with an optional hotel name", () => {
  assert.deepEqual(parseHotelSearchRequest(validRequest), validRequest);
  assert.deepEqual(parseHotelSearchRequest({ ...validRequest, query: "  Palace Hotel Tokyo  " }), {
    ...validRequest,
    query: "Palace Hotel Tokyo",
  });
  assert.deepEqual(parseHotelSearchRequest({ ...validRequest, query: "   " }), validRequest);
  assert.equal(parseHotelSearchRequest({ ...validRequest, latitude: 80 }), null);
  assert.equal(parseHotelSearchRequest({ ...validRequest, query: 42 }), null);
  assert.equal(parseHotelSearchRequest({ ...validRequest, languageCode: "ko" }), null);
});

test("requests live Google hotel evidence and returns a diverse deterministic shortlist", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const places = [
    {
      id: "hotel-a",
      displayName: { text: "Hotel A" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/hotel-a",
      websiteUri: "https://hotel-a.example",
      businessStatus: "OPERATIONAL",
      types: ["hotel", "lodging"],
      location: { latitude: 35.6813, longitude: 139.7672 },
      rating: 4.6,
      userRatingCount: 4_000,
      paymentOptions: { acceptsCashOnly: true, acceptsCreditCards: true },
      photos: [{
        name: "places/hotel-a/photos/1",
        authorAttributions: [{ displayName: "Hotel A", uri: "https://hotel-a.example/photos" }],
      }],
      reviews: [{
        rating: 5,
        text: { text: "PayPay was accepted at the front desk." },
        publishTime: "2026-07-01T00:00:00Z",
        relativePublishTimeDescription: "2 weeks ago",
        authorAttribution: { displayName: "Guest A" },
        googleMapsUri: "https://maps.google.com/review/a",
      }],
    },
    {
      id: "hotel-b",
      displayName: { text: "Hotel B" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/hotel-b",
      businessStatus: "OPERATIONAL",
      primaryType: "hotel",
      types: ["hotel", "lodging"],
      location: { latitude: 35.72, longitude: 139.8 },
      rating: 4.9,
      userRatingCount: 12_000,
    },
    {
      id: "hotel-c",
      displayName: { text: "Hotel C" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/hotel-c",
      businessStatus: "OPERATIONAL",
      types: ["lodging"],
      location: { latitude: 35.682, longitude: 139.768 },
      rating: 4.5,
      userRatingCount: 900,
      reviews: [{ text: { text: "Payment is cash only." } }],
    },
    {
      id: "hotel-d",
      displayName: { text: "Hotel D" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/hotel-d",
      businessStatus: "OPERATIONAL",
      types: ["hotel"],
      location: { latitude: 35.683, longitude: 139.769 },
      rating: 4.3,
      userRatingCount: 500,
    },
    {
      id: "restaurant",
      displayName: { text: "Hotel Named Restaurant" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/restaurant",
      businessStatus: "OPERATIONAL",
      types: ["restaurant"],
      location: { latitude: 35.6812, longitude: 139.7671 },
      rating: 5,
      userRatingCount: 100_000,
    },
    {
      id: "closed-hotel",
      displayName: { text: "Closed Hotel" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/closed-hotel",
      businessStatus: "CLOSED_PERMANENTLY",
      types: ["hotel", "lodging"],
      location: { latitude: 35.6812, longitude: 139.7671 },
      rating: 5,
      userRatingCount: 100_000,
    },
  ];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init: init ?? {} };
    return Response.json({ places });
  }) as typeof fetch;

  const results = await fetchGoogleHotelCandidates(validRequest, "secret", fetcher);
  // The shortlist seats best-overall, nearest, top-rated and per-band picks,
  // so it can exceed the old top-3 but never five and never duplicates.
  assert.ok(results.length >= 3 && results.length <= 5, `got ${results.length}`);
  assert.equal(new Set(results.map((candidate) => candidate.id)).size, results.length);
  assert.equal(results.some((candidate) => candidate.id === "restaurant" || candidate.id === "closed-hotel"), false);
  assert.equal(results[0].name, "Hotel A", "the best overall score still leads");
  assert.equal(results[0].photo?.name, "places/hotel-a/photos/1");
  assert.equal(results[0].reviews?.[0].authorName, "Guest A");
  assert.equal(results[0].payment?.cashOnly, null, "contradictory listing fields must not become a cash-only claim");
  assert.deepEqual(results[0].payment?.acceptedMethods, ["credit_card", "qr_code"]);
  assert.equal(results[0].payment?.source, "google_listing_and_review");
  assert.equal(results.find((candidate) => candidate.id === "hotel-c")?.payment?.cashOnly, true);

  assert.equal(captured?.url, "https://places.googleapis.com/v1/places:searchText");
  const headers = new Headers(captured?.init.headers);
  const requestedFields = headers.get("X-Goog-FieldMask") ?? "";
  assert.match(requestedFields, /places\.rating/);
  assert.match(requestedFields, /places\.reviews/);
  assert.match(requestedFields, /places\.paymentOptions/);
  assert.match(requestedFields, /places\.photos/);
  assert.match(requestedFields, /places\.businessStatus/);
  assert.match(requestedFields, /places\.types/);
  const body = JSON.parse(String(captured?.init.body));
  assert.equal(body.pageSize, 6);
  assert.equal(body.includedType, "hotel");
  assert.equal(body.locationBias.circle.center.latitude, validRequest.latitude);
});

test("a named hotel query is included and Google relevance remains a ranking signal", async () => {
  let body: Record<string, unknown> = {};
  const results = await fetchGoogleHotelCandidates(
    { ...validRequest, query: "Palace Hotel Tokyo" },
    "secret",
    (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ places: [
        {
          id: "exact",
          displayName: { text: "Palace Hotel Tokyo" },
          formattedAddress: "Marunouchi",
          googleMapsUri: "https://maps.google.com/exact",
          businessStatus: "OPERATIONAL",
          types: ["hotel", "lodging"],
          location: { latitude: 35.6846, longitude: 139.7618 },
          rating: 4.5,
          userRatingCount: 4_000,
        },
        {
          id: "popular",
          displayName: { text: "Another Popular Hotel" },
          formattedAddress: "Tokyo",
          googleMapsUri: "https://maps.google.com/popular",
          businessStatus: "OPERATIONAL",
          types: ["hotel"],
          location: { latitude: 35.6812, longitude: 139.7671 },
          rating: 4.9,
          userRatingCount: 20_000,
        },
      ] });
    }) as typeof fetch,
  );
  assert.equal(body.textQuery, "Palace Hotel Tokyo Tokyo Station Japan");
  assert.equal(results[0].id, "exact");
});

test("review payment reports are used only when listing evidence is absent", async () => {
  const fetcher = (async () => Response.json({ places: [{
    id: "review-hotel",
    displayName: { text: "Review Hotel" },
    formattedAddress: "Kyoto",
    googleMapsUri: "https://maps.google.com/review-hotel",
    businessStatus: "OPERATIONAL",
    types: ["hotel", "lodging"],
    location: { latitude: 35.0116, longitude: 135.7681 },
    reviews: [{ text: { text: "現金のみでした。" } }],
  }] })) as typeof fetch;
  const results = await fetchGoogleHotelCandidates({
    latitude: 35.0116,
    longitude: 135.7681,
    area: "京都駅",
    languageCode: "ja",
  }, "secret", fetcher);
  assert.equal(results[0].payment?.source, "google_review");
  assert.equal(results[0].payment?.cashOnly, true);
  assert.deepEqual(results[0].payment?.acceptedMethods, ["cash"]);
});

test("payment reports keep QR and transit IC positive/negative separate and neutralize conflicts", async () => {
  const fetcher = (async () => Response.json({ places: [{
    id: "payment-hotel",
    displayName: { text: "Payment Hotel" },
    formattedAddress: "Kyoto",
    googleMapsUri: "https://maps.google.com/payment-hotel",
    businessStatus: "OPERATIONAL",
    types: ["hotel", "lodging"],
    location: { latitude: 35.0116, longitude: 135.7681 },
    reviews: [
      { text: { text: "PayPayは使えません。" } },
      { text: { text: "Suicaで支払えました。" } },
      { text: { text: "カードは使えました。" } },
      { text: { text: "別の日はカードが使えませんでした。" } },
    ],
  }] })) as typeof fetch;
  const results = await fetchGoogleHotelCandidates({
    latitude: 35.0116,
    longitude: 135.7681,
    area: "京都駅",
    languageCode: "ja",
  }, "secret", fetcher);
  assert.deepEqual(results[0].payment?.acceptedMethods, ["transport_ic"]);
  assert.deepEqual(results[0].payment?.notAcceptedMethods, ["qr_code"]);
  assert.equal(results[0].payment?.cashOnly, null, "card rejection alone must never imply cash-only");
});

test("hotel styles are asserted only from Google's listed price level", () => {
  assert.deepEqual(hotelStyles("very_expensive", null, null), ["luxury"]);
  assert.deepEqual(hotelStyles("expensive", 4.8, 5_000), ["luxury"]);
  assert.deepEqual(hotelStyles("moderate", 4.4, 800), ["value"]);
  assert.deepEqual(hotelStyles("inexpensive", 4.1, 100), ["value"]);
  assert.deepEqual(hotelStyles("moderate", 4.4, 50), [], "thin review support must not claim value");
  assert.deepEqual(hotelStyles("moderate", 3.9, 800), [], "a low rating must not claim value");
  assert.deepEqual(hotelStyles(null, 4.9, 10_000), [], "no listed price level means no style claim");
});

test("area searches widen with a luxury query, dedupe by id, and keep each style reachable", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const standardPlaces = Array.from({ length: 4 }, (_, index) => ({
    id: `value-${index}`,
    displayName: { text: `Value Hotel ${index}` },
    formattedAddress: "Tokyo",
    googleMapsUri: `https://maps.google.com/value-${index}`,
    businessStatus: "OPERATIONAL",
    types: ["hotel", "lodging"],
    location: { latitude: 35.6812 + index * 0.001, longitude: 139.7671 },
    rating: 4.5,
    userRatingCount: 5_000,
    priceLevel: "PRICE_LEVEL_MODERATE",
  }));
  const luxuryPlaces = [
    standardPlaces[0],
    {
      id: "luxury-1",
      displayName: { text: "Grand Luxury Tokyo" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/luxury-1",
      businessStatus: "OPERATIONAL",
      types: ["hotel", "lodging"],
      location: { latitude: 35.684, longitude: 139.765 },
      rating: 4.7,
      userRatingCount: 2_000,
      priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE",
    },
  ];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return Response.json({ places: String(body.textQuery).includes("luxury") ? luxuryPlaces : standardPlaces });
  }) as typeof fetch;

  const results = await fetchGoogleHotelCandidates(validRequest, "secret", fetcher);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[0].textQuery, "Tokyo Station hotels");
  assert.equal(bodies[1].textQuery, "Tokyo Station luxury hotels");
  assert.equal(bodies[2].textQuery, "Tokyo Station budget business hotels");
  assert.equal(new Set(results.map((candidate) => candidate.id)).size, results.length, "duplicate ids must merge");
  assert.ok(results.some((candidate) => candidate.styles.includes("luxury")), "the best luxury candidate stays reachable");
  assert.ok(results.some((candidate) => candidate.styles.includes("value")));
  assert.equal(results.find((candidate) => candidate.id === "luxury-1")?.priceLevel, "very_expensive");
});

test("a failing luxury widening query never hides primary results", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(body.textQuery).includes("luxury")) throw new Error("quota");
    return Response.json({ places: [{
      id: "only-hotel",
      displayName: { text: "Only Hotel" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/only-hotel",
      businessStatus: "OPERATIONAL",
      types: ["hotel", "lodging"],
      location: { latitude: 35.6812, longitude: 139.7671 },
      rating: 4.2,
      userRatingCount: 1_000,
    }] });
  }) as typeof fetch;
  const results = await fetchGoogleHotelCandidates(validRequest, "secret", fetcher);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "only-hotel");
  assert.equal(results[0].styles.length, 0);
});

test("client payload contains only the hotel search anchor and optional query", () => {
  assert.deepEqual(buildHotelSearchPayload({
    latitude: 35.6812,
    longitude: 139.7671,
    area: "Tokyo Station",
    query: "  Palace Hotel Tokyo ",
  }, "en"), {
    latitude: 35.6812,
    longitude: 139.7671,
    area: "Tokyo Station",
    query: "Palace Hotel Tokyo",
    languageCode: "en",
  });
  assert.deepEqual(buildHotelSearchPayload({
    latitude: 35.6812,
    longitude: 139.7671,
    area: "東京駅",
  }, "ja"), {
    latitude: 35.6812,
    longitude: 139.7671,
    area: "東京駅",
    languageCode: "ja",
  });
});

test("client maps server and network failures to bounded error codes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ code: "not_configured" }, { status: 503 })) as typeof fetch;
    await assert.rejects(
      requestHotelRecommendations(validRequest, "en"),
      (error: unknown) => error instanceof HotelRecommendationsError && error.code === "not_configured",
    );
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    await assert.rejects(
      requestHotelRecommendations(validRequest, "en"),
      (error: unknown) => error instanceof HotelRecommendationsError && error.code === "unavailable",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
