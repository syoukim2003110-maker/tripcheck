import assert from "node:assert/strict";
import test from "node:test";
import { fetchPlaceIntelligence, parsePlaceIntelligenceRequest } from "../lib/place-intelligence.ts";

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
  assert.equal(result.place.payment.cashOnly, null);
  assert.equal(result.reviews[0].authorName, "A guest");
  assert.equal(result.analyzedBy, "rules");
  assert.match(fieldMask, /places\.reviews/);
  assert.match(fieldMask, /places\.paymentOptions/);
});
