import assert from "node:assert/strict";
import test from "node:test";
import { extractPaymentObservations, fetchPlaceIntelligence, parsePlaceIntelligenceRequest } from "../lib/place-intelligence.ts";

const coordinate = { latitude: 35.6812, longitude: 139.7671 };

test("accepts only a bounded one-place field check", () => {
  assert.deepEqual(parsePlaceIntelligenceRequest({ name: "浅草寺", area: "浅草", languageCode: "ja", ...coordinate }), {
    name: "浅草寺",
    area: "浅草",
    ...coordinate,
    languageCode: "ja",
    destination: "auto",
  });
  assert.equal(
    parsePlaceIntelligenceRequest({ name: "Gornergrat", area: "Zermatt", languageCode: "en", destination: "switzerland", ...coordinate })?.destination,
    "switzerland",
  );
  assert.equal(parsePlaceIntelligenceRequest({ name: "", area: "浅草", languageCode: "ja", ...coordinate }), null);
  assert.equal(parsePlaceIntelligenceRequest({ name: "浅草寺", area: "浅草", languageCode: "ko", ...coordinate }), null);
  assert.equal(
    parsePlaceIntelligenceRequest({ name: "浅草寺", area: "浅草", languageCode: "ja", scope: "planning", ...coordinate })?.scope,
    "planning",
  );
});

test("planning scope requests hours and identity without enrichment fields", async () => {
  let fieldMask = "";
  const result = await fetchPlaceIntelligence(
    { name: "Sample Temple", area: "Tokyo", languageCode: "en", destination: "japan", scope: "planning", ...coordinate },
    "places-key",
    null,
    async (_url, init) => {
      fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
      return Response.json({ places: [{
        id: "place-planning",
        displayName: { text: "Sample Temple" },
        formattedAddress: "Tokyo",
        location: coordinate,
        googleMapsUri: "https://maps.google.com/sample-planning",
        businessStatus: "OPERATIONAL",
        regularOpeningHours: { periods: [] },
      }] });
    },
  );
  assert.equal(result.place.name, "Sample Temple");
  assert.match(fieldMask, /places\.regularOpeningHours/);
  assert.doesNotMatch(fieldMask, /reviews|photos|paymentOptions|rating/);
  assert.equal(result.reviews.length, 0);
});

test("returns attributed live evidence and does not invent missing payment facts", async () => {
  let fieldMask = "";
  const result = await fetchPlaceIntelligence(
    { name: "Sample Cafe", area: "Tokyo", languageCode: "en", destination: "japan", ...coordinate },
    "places-key",
    null,
    async (_url, init) => {
      fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
      return Response.json({ places: [{
        id: "place-1",
        displayName: { text: "Sample Cafe" },
        formattedAddress: "Tokyo",
        location: coordinate,
        googleMapsUri: "https://maps.google.com/sample",
        websiteUri: "https://example.com",
        businessStatus: "OPERATIONAL",
        currentOpeningHours: { openNow: true, weekdayDescriptions: ["Monday: 09:00–18:00"] },
        regularOpeningHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } }] },
        rating: 4.4,
        userRatingCount: 123,
        reviews: [{
          rating: 4,
          text: { text: "The line was long after noon." },
          publishTime: "2026-07-18T01:00:00Z",
          relativePublishTimeDescription: "2 days ago",
          authorAttribution: { displayName: "A guest", uri: "https://maps.google.com/contrib/1" },
          googleMapsUri: "https://maps.google.com/review/1",
        }],
      }] });
    },
  );
  assert.equal(result.place.openNow, true);
  assert.equal(result.place.regularOpeningPeriods?.length, 1);
  assert.equal(result.place.payment.cashOnly, null);
  assert.deepEqual(result.place.payment.observations, []);
  assert.equal(result.reviews[0].authorName, "A guest");
  assert.equal(result.analyzedBy, "rules");
  assert.match(fieldMask, /places\.reviews/);
  assert.match(fieldMask, /places\.paymentOptions/);
});

test("uses exact Place Details for a resolved provider reference", async () => {
  let requestedUrl = "";
  let requestedMethod = "";
  let fieldMask = "";
  const result = await fetchPlaceIntelligence(
    { name: "Sample Cafe", area: "Tokyo", languageCode: "en", destination: "japan", providerRef: "ChIJexact_123", ...coordinate },
    "places-key",
    null,
    async (url, init) => {
      requestedUrl = String(url);
      requestedMethod = init?.method ?? "";
      fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
      return Response.json({
        id: "ChIJexact_123",
        displayName: { text: "Sample Cafe" },
        formattedAddress: "Tokyo",
        location: coordinate,
        googleMapsUri: "https://maps.google.com/sample",
        regularOpeningHours: { periods: [] },
      });
    },
  );

  assert.match(requestedUrl, /\/v1\/places\/ChIJexact_123\?languageCode=en$/);
  assert.equal(requestedMethod, "GET");
  assert.match(fieldMask, /regularOpeningHours/);
  assert.doesNotMatch(fieldMask, /reviews|paymentOptions|photos/);
  assert.equal(result.place.name, "Sample Cafe");
});

test("extracts explicit payment reports from Google review text without guessing", () => {
  const baseReview = {
    rating: 4,
    publishedAt: "2026-07-18T01:00:00Z",
    relativeTime: "2 days ago",
    authorName: "Guest",
    authorUri: null,
    googleMapsUri: "https://maps.google.com/review/1",
  };
  const observations = extractPaymentObservations([
    { ...baseReview, text: "支払いは現金のみでした。" },
    { ...baseReview, text: "PayPayで支払えました。" },
  ]);

  assert.equal(observations[0].method, "qr");
  assert.equal(observations[0].accepted, true);
  assert.match(observations[0].excerpt, /PayPay/);
  assert.equal(observations.some(({ method }) => method === "cash"), false, "conflicting cash-only wording must be neutralized");

  const cashOnly = extractPaymentObservations([{ ...baseReview, text: "支払いは現金のみでした。" }]);
  assert.equal(cashOnly[0].method, "cash");
  assert.equal(cashOnly[0].accepted, true);

  const rejected = extractPaymentObservations([
    { ...baseReview, text: "PayPayは使えません。" },
    { ...baseReview, text: "Suicaは利用不可でした。" },
    { ...baseReview, text: "カードは使えません。" },
  ]);
  assert.deepEqual(rejected.map(({ method, accepted }) => [method, accepted]), [
    ["qr", false],
    ["transport_ic", false],
    ["card", false],
  ]);
  const englishNegative = extractPaymentObservations([{ ...baseReview, text: "PayPay was not accepted." }]);
  assert.deepEqual(englishNegative.map(({ method, accepted }) => [method, accepted]), [["qr", false]]);
});

test("does not call a listing cash-only when another listed method is accepted", async () => {
  const result = await fetchPlaceIntelligence(
    { name: "Sample Shop", area: "Tokyo", languageCode: "en", destination: "japan", ...coordinate },
    "places-key",
    null,
    (async () => Response.json({ places: [{
      id: "place-2",
      displayName: { text: "Sample Shop" },
      formattedAddress: "Tokyo",
      location: coordinate,
      googleMapsUri: "https://maps.google.com/sample-2",
      paymentOptions: { acceptsCashOnly: true, acceptsCreditCards: true },
    }] })) as typeof fetch,
  );

  assert.equal(result.place.payment.cashOnly, null);
  assert.equal(result.place.payment.creditCards, true);
});

test("neutralizes cash-only listing when a review explicitly reports non-cash payment", async () => {
  const result = await fetchPlaceIntelligence(
    { name: "Sample Shop", area: "Tokyo", languageCode: "en", destination: "japan", ...coordinate },
    "places-key",
    null,
    (async () => Response.json({ places: [{
      id: "place-3",
      displayName: { text: "Sample Shop" },
      formattedAddress: "Tokyo",
      location: coordinate,
      googleMapsUri: "https://maps.google.com/sample-3",
      paymentOptions: { acceptsCashOnly: true },
      reviews: [{
        text: { text: "I paid by credit card yesterday." },
        relativePublishTimeDescription: "1 day ago",
      }],
    }] })) as typeof fetch,
  );

  assert.equal(result.place.payment.cashOnly, null);
  assert.deepEqual(result.place.payment.observations.map(({ method, accepted }) => [method, accepted]), [["card", true]]);
  assert.equal(result.analysis.signals.some(({ title }) => /cash only/i.test(title)), false);
});

test("neutralizes listing and review claims when they disagree about cards", async () => {
  const result = await fetchPlaceIntelligence(
    { name: "Sample Shop", area: "Tokyo", languageCode: "en", destination: "japan", ...coordinate },
    "places-key",
    null,
    (async () => Response.json({ places: [{
      id: "place-4",
      displayName: { text: "Sample Shop" },
      formattedAddress: "Tokyo",
      location: coordinate,
      googleMapsUri: "https://maps.google.com/sample-4",
      paymentOptions: { acceptsCreditCards: true },
      reviews: [{
        text: { text: "Credit cards are not accepted." },
        relativePublishTimeDescription: "1 day ago",
      }],
    }] })) as typeof fetch,
  );

  assert.equal(result.place.payment.creditCards, null);
  assert.equal(result.place.payment.observations.some(({ method }) => method === "card"), false);
  assert.equal(result.analysis.signals.some(({ kind }) => kind === "payment"), false);
});

test("returns a proxyable place photo with its attribution and rejects malformed names", async () => {
  const build = (photos: unknown) => fetchPlaceIntelligence(
    { name: "Sample Cafe", area: "Tokyo", languageCode: "en", destination: "japan", ...coordinate },
    "places-key",
    null,
    (async () => Response.json({ places: [{
      displayName: { text: "Sample Cafe" },
      location: coordinate,
      googleMapsUri: "https://maps.google.com/sample",
      photos,
    }] })) as typeof fetch,
  );

  const withPhoto = await build([{
    name: "places/abcd1234efgh/photos/photo5678ijkl",
    authorAttributions: [{ displayName: "A local guide", uri: "https://maps.google.com/contrib/9" }],
  }]);
  assert.equal(withPhoto.place.photoName, "places/abcd1234efgh/photos/photo5678ijkl");
  assert.deepEqual(withPhoto.place.photoAttribution, { name: "A local guide", uri: "https://maps.google.com/contrib/9" });

  const malformed = await build([{ name: "https://evil.example.com/injected" }]);
  assert.equal(malformed.place.photoName, null);
  assert.equal(malformed.place.photoAttribution, null);
});
