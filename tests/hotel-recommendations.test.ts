import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  buildHotelSearchPayload,
  HotelRecommendationsError,
  requestHotelRecommendations,
} from "../lib/hotel-recommendations-client.ts";
import { fetchGoogleHotelCandidates, hotelStyles, parseHotelSearchRequest, placeTypesIncludeLodging } from "../lib/google-hotels.ts";
import { bayesianWeightedRating, hotelRatingPrior, restaurantRatingPrior } from "../lib/rating-confidence.ts";

// App routes use bundler-style extensionless imports. This narrow test hook
// lets Node's type-stripping runner load the real handler without changing the
// production import or introducing a second implementation in the test.
const routeHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromRoute = context.parentURL?.endsWith("/app/api/hotel-recommendations/route.ts");
    const match = fromRoute ? specifier.match(/^\.\.\/\.\.\/\.\.\/lib\/(.+)$/) : null;
    if (match) return nextResolve(new URL(`../lib/${match[1]}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { POST: hotelRecommendationsRoute } = await import(
  new URL("../app/api/hotel-recommendations/route.ts", import.meta.url).href
) as { POST(request: Request): Promise<Response> };
routeHooks.deregister();

const validRequest = {
  latitude: 35.6812,
  longitude: 139.7671,
  area: "Tokyo Station",
  languageCode: "en" as const,
  destination: "japan" as const,
};

test("distinguishes an actual lodging result from a station or area typed in the hotel field", () => {
  assert.equal(placeTypesIncludeLodging(["hotel", "lodging"]), true);
  assert.equal(placeTypesIncludeLodging(["japanese_inn", "lodging"]), true);
  assert.equal(placeTypesIncludeLodging(["train_station", "transit_station"]), false);
});

test("accepts a bounded hotel search with an optional hotel name", () => {
  assert.deepEqual(parseHotelSearchRequest(validRequest), validRequest);
  assert.deepEqual(parseHotelSearchRequest({ ...validRequest, query: "  Palace Hotel Tokyo  " }), {
    ...validRequest,
    query: "Palace Hotel Tokyo",
  });
  assert.deepEqual(parseHotelSearchRequest({ ...validRequest, query: "   " }), validRequest);
  const routePoints = [
    { latitude: 35.0116, longitude: 135.7681 },
    { latitude: 34.6851, longitude: 135.8048 },
  ];
  assert.deepEqual(parseHotelSearchRequest({ ...validRequest, routePoints }), { ...validRequest, routePoints });
  assert.equal(parseHotelSearchRequest({ ...validRequest, routePoints: Array.from({ length: 11 }, () => routePoints[0]) }), null);
  assert.equal(parseHotelSearchRequest({ ...validRequest, routePoints: [{ latitude: 95, longitude: 135 }] }), null);
  assert.equal(parseHotelSearchRequest({ ...validRequest, latitude: 95 }), null);
  // A Swiss anchor is a legitimate hotel search now.
  assert.equal(
    parseHotelSearchRequest({ ...validRequest, latitude: 46.02, longitude: 7.75, destination: "switzerland" })?.destination,
    "switzerland",
  );
  assert.equal(parseHotelSearchRequest({ ...validRequest, destination: "narnia" })?.destination, "auto");
  assert.equal(parseHotelSearchRequest({ ...validRequest, query: 42 }), null);
  assert.equal(parseHotelSearchRequest({ ...validRequest, languageCode: "ko" }), null);
});

test("rating and review count are judged together, never as independent bonuses", () => {
  const thinStellar = bayesianWeightedRating(4.9, 8);
  const broadNormal = bayesianWeightedRating(4.3, 3_000);
  const broadStrong = bayesianWeightedRating(4.6, 2_100);
  assert.ok(thinStellar !== null && broadNormal !== null && broadStrong !== null);
  assert.ok(thinStellar < broadNormal, "a 4.9★ over 8 reviews must trail a 4.3★ over 3,000 reviews");
  assert.ok(broadNormal < broadStrong, "with real volume the better average wins again");
  // Eight reviews barely move the prior: the raw 4.9 average is not yet believed.
  assert.ok(Math.abs(thinStellar - hotelRatingPrior.priorMean) < 0.05);
  // Volume alone cannot invent quality, and zero volume collapses to the prior.
  assert.equal(bayesianWeightedRating(null, 100_000), null);
  assert.equal(bayesianWeightedRating(4.8, null), hotelRatingPrior.priorMean);
  assert.equal(bayesianWeightedRating(4.8, 0), hotelRatingPrior.priorMean);
  // The restaurant prior trusts a given sample sooner than the hotel prior.
  const hotelView = bayesianWeightedRating(4.9, 200, hotelRatingPrior);
  const restaurantView = bayesianWeightedRating(4.9, 200, restaurantRatingPrior);
  assert.ok(hotelView !== null && restaurantView !== null && hotelView < restaurantView);
});

test("a thin-sample stellar average neither leads the shortlist nor claims the best-rated seat", async () => {
  const hotel = (id: string, name: string, rating: number, userRatingCount: number, latitudeOffset: number) => ({
    id,
    displayName: { text: name },
    formattedAddress: "Tokyo",
    googleMapsUri: `https://maps.google.com/${id}`,
    businessStatus: "OPERATIONAL",
    types: ["hotel", "lodging"],
    location: { latitude: validRequest.latitude + latitudeOffset, longitude: validRequest.longitude },
    rating,
    userRatingCount,
  });
  const places = [
    hotel("near-average", "Near Average Hotel", 3.9, 2_000, 0),
    hotel("crowd-proven", "Crowd Proven Hotel", 4.4, 8_000, 0.002),
    hotel("tiny-gem", "Tiny Gem Hotel", 4.9, 60, 0.004),
    hotel("mid-value", "Mid Value Hotel", 4.2, 1_500, 0.001),
  ];
  const results = await fetchGoogleHotelCandidates(validRequest, "secret", (async () => Response.json({ places })) as typeof fetch);
  // 4.9★×60 is a thin sample: its weighted rating sits near the prior, so the
  // broadly proven 4.4★×8,000 leads overall AND takes the best-rated seat;
  // the tiny gem enters only as the last ordinary fill.
  assert.deepEqual(results.map(({ id }) => id), ["crowd-proven", "near-average", "mid-value", "tiny-gem"]);
});

test("whole-itinerary access outranks closeness to the single search anchor", async () => {
  const places = [
    {
      id: "anchor-near",
      displayName: { text: "Anchor Near Hotel" },
      formattedAddress: "Miyazu",
      googleMapsUri: "https://maps.google.com/anchor-near",
      businessStatus: "OPERATIONAL",
      types: ["hotel", "lodging"],
      location: { latitude: 35.535, longitude: 135.195 },
      rating: 4.4,
      userRatingCount: 1_000,
    },
    {
      id: "route-central",
      displayName: { text: "Route Central Hotel" },
      formattedAddress: "Kyoto",
      googleMapsUri: "https://maps.google.com/route-central",
      businessStatus: "OPERATIONAL",
      types: ["hotel", "lodging"],
      location: { latitude: 35.0116, longitude: 135.7681 },
      rating: 4.4,
      userRatingCount: 1_000,
    },
  ];
  const results = await fetchGoogleHotelCandidates({
    latitude: 35.535,
    longitude: 135.195,
    area: "Kyoto",
    languageCode: "en",
    destination: "japan",
    routePoints: [
      { latitude: 35.0116, longitude: 135.7681 },
      { latitude: 35.021, longitude: 135.755 },
      { latitude: 34.995, longitude: 135.775 },
    ],
  }, "secret", (async () => Response.json({ places })) as typeof fetch);
  assert.equal(results[0].id, "route-central");
  assert.ok(results[0].routeAverageDistanceMeters < results[1].routeAverageDistanceMeters);
  assert.ok(results[0].routeWorstDistanceMeters < results[1].routeWorstDistanceMeters);
});

test("requests live Google hotel evidence and returns a diverse deterministic shortlist", async () => {
  const captured: { value: { url: string; init: RequestInit } | null } = { value: null };
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
    captured.value = { url: String(url), init: init ?? {} };
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

  assert.equal(captured.value?.url, "https://places.googleapis.com/v1/places:searchText");
  const headers = new Headers(captured.value?.init.headers);
  const requestedFields = headers.get("X-Goog-FieldMask") ?? "";
  assert.match(requestedFields, /places\.rating/);
  assert.match(requestedFields, /places\.reviews/);
  assert.match(requestedFields, /places\.paymentOptions/);
  assert.match(requestedFields, /places\.photos/);
  assert.match(requestedFields, /places\.businessStatus/);
  assert.match(requestedFields, /places\.types/);
  const body = JSON.parse(String(captured.value?.init.body));
  assert.equal(body.pageSize, 6);
  assert.equal(body.includedType, "hotel");
  assert.equal(body.locationBias.circle.center.latitude, validRequest.latitude);
});

test("a named hotel query is included and Google relevance remains a ranking signal", async () => {
  let body: Record<string, unknown> = {};
  let requestedUrl = "";
  let requestCount = 0;
  const results = await fetchGoogleHotelCandidates(
    { ...validRequest, query: "Palace Hotel Tokyo" },
    "secret",
    (async (url, init) => {
      requestedUrl = String(url);
      requestCount += 1;
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
  assert.equal(requestCount, 1);
  assert.equal(requestedUrl, "https://places.googleapis.com/v1/places:searchText");
  assert.equal(body.textQuery, "Palace Hotel Tokyo Tokyo Station Japan");
  assert.equal(results[0].id, "exact");
});

const vispRequest = {
  latitude: 46.294,
  longitude: 7.881,
  area: "Visp",
  languageCode: "en" as const,
  destination: "switzerland" as const,
};
const vispPlaces = [
  {
    id: "campground",
    displayName: { text: "Camping Mühleye Visp" },
    formattedAddress: "Visp",
    googleMapsUri: "https://maps.google.com/campground",
    businessStatus: "OPERATIONAL",
    types: ["campground", "lodging"],
    location: { latitude: 46.297, longitude: 7.875 },
    rating: 4.6,
    userRatingCount: 900,
  },
  {
    id: "real-hotel",
    displayName: { text: "Hotel Visp" },
    formattedAddress: "Visp",
    googleMapsUri: "https://maps.google.com/real-hotel",
    businessStatus: "OPERATIONAL",
    types: ["hotel", "lodging"],
    location: { latitude: 46.293, longitude: 7.882 },
    rating: 4.3,
    userRatingCount: 700,
  },
];

test("automatic recommendations drop campgrounds and ask Google to exclude them server-side", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Response.json({ places: vispPlaces });
  }) as typeof fetch;
  const results = await fetchGoogleHotelCandidates(vispRequest, "secret", fetcher);
  assert.ok(results.some((candidate) => candidate.id === "real-hotel"));
  assert.equal(results.some((candidate) => candidate.id === "campground"), false,
    "a campground must never appear among automatic hotel recommendations");
  const nearby = requests.find(({ url }) => url.endsWith(":searchNearby"));
  assert.ok(nearby, "the automatic path starts with a nearby category search");
  const excludedTypes = nearby.body.excludedTypes as string[];
  for (const type of ["campground", "rv_park", "mobile_home_park"]) {
    assert.ok(excludedTypes.includes(type), `searchNearby must exclude ${type} server-side`);
  }
});

test("a query that names the campground still returns it", async () => {
  const results = await fetchGoogleHotelCandidates(
    { ...vispRequest, query: "Camping Mühleye Visp" },
    "secret",
    (async () => Response.json({ places: vispPlaces })) as typeof fetch,
  );
  assert.equal(results[0]?.id, "campground", "an explicitly typed campground name is respected");
  assert.ok(results.some((candidate) => candidate.id === "real-hotel"));
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
    destination: "japan",
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
    destination: "japan",
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

test("area searches start from the route-center coordinates, widen by style, dedupe, and keep each style reachable", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  const standardPlaces = Array.from({ length: 4 }, (_, index) => ({
    id: `value-${index}`,
    displayName: { text: `Value Hotel ${index}` },
    formattedAddress: "Tokyo",
    googleMapsUri: `https://maps.google.com/value-${index}`,
    businessStatus: "OPERATIONAL",
    primaryType: index === 0 ? "japanese_inn" : "hotel",
    types: index === 0 ? ["japanese_inn", "lodging"] : ["hotel", "lodging"],
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
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    urls.push(String(url));
    bodies.push(body);
    return Response.json({ places: String(body.textQuery).includes("luxury") ? luxuryPlaces : standardPlaces });
  }) as typeof fetch;

  const results = await fetchGoogleHotelCandidates(validRequest, "secret", fetcher);
  assert.equal(bodies.length, 3);
  assert.deepEqual(urls, [
    "https://places.googleapis.com/v1/places:searchNearby",
    "https://places.googleapis.com/v1/places:searchText",
    "https://places.googleapis.com/v1/places:searchText",
  ]);
  assert.ok((bodies[0].includedTypes as string[]).includes("hotel"));
  assert.ok((bodies[0].includedTypes as string[]).includes("japanese_inn"));
  assert.equal(bodies[0].maxResultCount, 20);
  assert.equal("textQuery" in bodies[0], false);
  assert.deepEqual((bodies[0].locationRestriction as { circle: { center: unknown } }).circle.center, {
    latitude: validRequest.latitude,
    longitude: validRequest.longitude,
  });
  assert.equal(bodies[1].textQuery, "luxury hotels");
  assert.equal(bodies[2].textQuery, "budget business hotels");
  assert.equal(JSON.stringify(bodies).includes(validRequest.area), false, "an area label must not override the route-center coordinates");
  assert.equal(new Set(results.map((candidate) => candidate.id)).size, results.length, "duplicate ids must merge");
  assert.ok(results.some((candidate) => candidate.id === "value-0"), "Japanese inns stay in the lodging comparison");
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

test("client payload contains the bounded hotel search anchor, day route points and optional query", () => {
  const routePoints = [{ latitude: 35.0116, longitude: 135.7681 }];
  assert.deepEqual(buildHotelSearchPayload({
    latitude: 35.6812,
    longitude: 139.7671,
    area: "Tokyo Station",
    query: "  Palace Hotel Tokyo ",
    routePoints,
  }, "en"), {
    latitude: 35.6812,
    longitude: 139.7671,
    area: "Tokyo Station",
    query: "Palace Hotel Tokyo",
    routePoints,
    languageCode: "en",
    destination: "auto",
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
    destination: "auto",
  });
  assert.equal(buildHotelSearchPayload({
    latitude: 46.0207,
    longitude: 7.7491,
    area: "Zermatt",
  }, "en", "switzerland").destination, "switzerland");
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

test("route reports Rakuten evidence availability and logs only a bounded failure code", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalRakutenId = process.env.RAKUTEN_APPLICATION_ID;
  const originalRakutenKey = process.env.RAKUTEN_ACCESS_KEY;
  const originalNonCoreApis = process.env.TRIPCHECK_NON_CORE_APIS_ENABLED;
  const warnings: unknown[][] = [];
  const googleHotel = (latitude: number, longitude: number) => ({
    id: `hotel-${latitude}`,
    displayName: { text: "Test Hotel" },
    formattedAddress: "Tokyo",
    googleMapsUri: "https://maps.google.com/test-hotel",
    businessStatus: "OPERATIONAL",
    types: ["hotel", "lodging"],
    location: { latitude, longitude },
    rating: 4.5,
    userRatingCount: 500,
  });
  const requestFor = (latitude: number, longitude: number) => new Request("http://tripcheck.test/api/hotel-recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://tripcheck.test" },
    body: JSON.stringify({
      latitude,
      longitude,
      area: "Tokyo",
      query: "Test Hotel",
      languageCode: "en",
      destination: "japan",
    }),
  });

  try {
    process.env.GOOGLE_PLACES_API_KEY = "google-secret";
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-id";
    process.env.RAKUTEN_ACCESS_KEY = "rakuten-secret";
    process.env.TRIPCHECK_NON_CORE_APIS_ENABLED = "true";
    console.warn = (...args: unknown[]) => { warnings.push(args); };

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.startsWith("https://places.googleapis.com/")) {
        return Response.json({ places: [googleHotel(35.6812, 139.7671)] });
      }
      if (url.startsWith("https://openapi.rakuten.co.jp/")) return Response.json({ hotels: [] });
      throw new Error("unexpected provider");
    }) as typeof fetch;
    const successResponse = await hotelRecommendationsRoute(requestFor(35.6812, 139.7671));
    const success = await successResponse.json() as { evidenceProviders: { rakuten: boolean } };
    assert.equal(successResponse.status, 200);
    assert.deepEqual(success.evidenceProviders, { rakuten: true }, "an empty successful result still proves the provider was available");

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.startsWith("https://places.googleapis.com/")) {
        return Response.json({ places: [googleHotel(35.6895, 139.6917)] });
      }
      if (url.startsWith("https://openapi.rakuten.co.jp/")) {
        return Response.json({ errors: { errorMessage: "CLIENT_IP_NOT_ALLOWED" } }, { status: 403 });
      }
      throw new Error("unexpected provider");
    }) as typeof fetch;
    const failureResponse = await hotelRecommendationsRoute(requestFor(35.6895, 139.6917));
    const failure = await failureResponse.json() as { evidenceProviders: { rakuten: boolean }; candidates: unknown[] };
    assert.equal(failureResponse.status, 200, "optional Rakuten failure must not hide Google candidates");
    assert.equal(failure.candidates.length, 1);
    assert.deepEqual(failure.evidenceProviders, { rakuten: false });
    assert.deepEqual(warnings, [["rakuten_optional_unavailable"]]);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalGoogleKey;
    if (originalRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
    else process.env.RAKUTEN_APPLICATION_ID = originalRakutenId;
    if (originalRakutenKey === undefined) delete process.env.RAKUTEN_ACCESS_KEY;
    else process.env.RAKUTEN_ACCESS_KEY = originalRakutenKey;
    if (originalNonCoreApis === undefined) delete process.env.TRIPCHECK_NON_CORE_APIS_ENABLED;
    else process.env.TRIPCHECK_NON_CORE_APIS_ENABLED = originalNonCoreApis;
  }
});
