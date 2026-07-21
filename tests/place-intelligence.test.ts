import assert from "node:assert/strict";
import test from "node:test";
import { extractPaymentObservations, fetchPlaceIntelligence, parsePlaceIntelligenceRequest } from "../lib/place-intelligence.ts";

test("accepts only a bounded one-place field check", () => {
  assert.deepEqual(parsePlaceIntelligenceRequest({ name: "浅草寺", area: "浅草", languageCode: "ja" }), {
    name: "浅草寺",
    area: "浅草",
    languageCode: "ja",
  });
  assert.equal(parsePlaceIntelligenceRequest({ name: "", area: "浅草", languageCode: "ja" }), null);
  assert.equal(parsePlaceIntelligenceRequest({ name: "浅草寺", area: "浅草", languageCode: "ko" }), null);
});

test("returns attributed live evidence and does not invent missing payment facts", async () => {
  let fieldMask = "";
  const result = await fetchPlaceIntelligence(
    { name: "Sample Cafe", area: "Tokyo", languageCode: "en" },
    "places-key",
    null,
    async (_url, init) => {
      fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
      return Response.json({ places: [{
        id: "place-1",
        displayName: { text: "Sample Cafe" },
        formattedAddress: "Tokyo",
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
    { name: "Sample Shop", area: "Tokyo", languageCode: "en" },
    "places-key",
    null,
    (async () => Response.json({ places: [{
      id: "place-2",
      displayName: { text: "Sample Shop" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/sample-2",
      paymentOptions: { acceptsCashOnly: true, acceptsCreditCards: true },
    }] })) as typeof fetch,
  );

  assert.equal(result.place.payment.cashOnly, null);
  assert.equal(result.place.payment.creditCards, true);
});

test("neutralizes cash-only listing when a review explicitly reports non-cash payment", async () => {
  const result = await fetchPlaceIntelligence(
    { name: "Sample Shop", area: "Tokyo", languageCode: "en" },
    "places-key",
    null,
    (async () => Response.json({ places: [{
      id: "place-3",
      displayName: { text: "Sample Shop" },
      formattedAddress: "Tokyo",
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
    { name: "Sample Shop", area: "Tokyo", languageCode: "en" },
    "places-key",
    null,
    (async () => Response.json({ places: [{
      id: "place-4",
      displayName: { text: "Sample Shop" },
      formattedAddress: "Tokyo",
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
