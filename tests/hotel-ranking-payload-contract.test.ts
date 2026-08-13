import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildHotelRankingPayload, type HotelRankingInput } from "../lib/hotel-recommendations-client.ts";
import { buildAnthropicHotelRankingBody, parseHotelRankingRequest } from "../lib/ai-hotel-ranking.ts";

// P1-02. Every other outbound body had a builder with a deep-equality test;
// this one was assembled inline at the call site. Adding `tripStartDate` and
// `itineraryExcerpt` to it passed all 575 non-Worker tests. The server would
// have stripped both before Anthropic saw them, but they would still have
// crossed the network and landed in request logs.

const INPUT: HotelRankingInput = {
  destination: "Tokyo",
  area: "Ueno",
  tripDays: 3,
  purpose: "balanced",
  candidates: [
    {
      id: "hotel-a",
      name: "Hotel A",
      area: "Ueno 1-2-3",
      rating: 4.3,
      reviewCount: 1200,
      totalTravelMinutes: 180,
      styles: ["value"],
      priceHint: "~¥18,000/night",
    },
    {
      id: "hotel-b",
      name: "Hotel B",
      area: "Asakusa 4-5",
      rating: null,
      reviewCount: null,
      totalTravelMinutes: null,
      styles: [],
      priceHint: null,
    },
  ],
};

test("the ranking request body is exactly these fields, in both locales", () => {
  assert.deepStrictEqual(buildHotelRankingPayload(INPUT, "ja"), {
    destination: "Tokyo",
    area: "Ueno",
    tripDays: 3,
    purpose: "balanced",
    languageCode: "ja",
    candidates: [
      { id: "hotel-a", name: "Hotel A", area: "Ueno 1-2-3", rating: 4.3, reviewCount: 1200, totalTravelMinutes: 180, styles: ["value"], priceHint: "~¥18,000/night" },
      { id: "hotel-b", name: "Hotel B", area: "Asakusa 4-5", rating: null, reviewCount: null, totalTravelMinutes: null, styles: [], priceHint: null },
    ],
  });
  assert.equal(buildHotelRankingPayload(INPUT, "en").languageCode, "en");
});

test("nothing the caller adds to the input can ride along", () => {
  const contaminated = {
    ...INPUT,
    tripStartDate: "2026-04-11",
    itineraryExcerpt: "Ghibli Museum 10:00, Shibuya Sky 15:00",
    candidates: INPUT.candidates.map((candidate) => ({
      ...candidate,
      bookingReference: "ABC-123",
      travellerNote: "anniversary",
    })),
  } as unknown as HotelRankingInput;

  const payload = buildHotelRankingPayload(contaminated, "en");
  assert.deepStrictEqual(Object.keys(payload).sort(), ["area", "candidates", "destination", "languageCode", "purpose", "tripDays"]);
  for (const candidate of payload.candidates) {
    assert.deepStrictEqual(
      Object.keys(candidate).sort(),
      ["area", "id", "name", "priceHint", "rating", "reviewCount", "styles", "totalTravelMinutes"],
    );
  }
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /2026-04-11|Ghibli|ABC-123|anniversary/);
});

test("the client body is the whole request the server will accept", () => {
  const payload = buildHotelRankingPayload(INPUT, "en");
  const parsed = parseHotelRankingRequest(payload);
  assert.ok(parsed, "the server must accept the exact body the client sends");
  assert.deepStrictEqual(parsed, payload, "no field is dropped, added or reshaped in between");
});

test("an unknown key is stripped by the server, not forwarded", () => {
  const parsed = parseHotelRankingRequest({
    ...buildHotelRankingPayload(INPUT, "en"),
    tripStartDate: "2026-04-11",
    itineraryExcerpt: "Ghibli Museum 10:00",
  });
  assert.ok(parsed);
  assert.equal("tripStartDate" in parsed, false);
  assert.equal("itineraryExcerpt" in parsed, false);
});

test("the Anthropic body carries the shortlist and nothing about the itinerary", () => {
  const parsed = parseHotelRankingRequest({
    ...buildHotelRankingPayload(INPUT, "en"),
    tripStartDate: "2026-04-11",
    itineraryExcerpt: "Ghibli Museum 10:00",
  })!;
  const body = buildAnthropicHotelRankingBody(parsed);
  const userContent = JSON.parse((body.messages[0].content) as string) as Record<string, unknown>;
  assert.deepStrictEqual(
    Object.keys(userContent).sort(),
    ["area", "candidates", "destination", "purpose", "task", "tripDays"],
  );
  assert.doesNotMatch(JSON.stringify(body), /2026-04-11|Ghibli/);
  // Trip length is a count, never a date; the outbound body must not be able
  // to reconstruct when the traveller is away.
  assert.equal(userContent.tripDays, 3);
  assert.doesNotMatch(JSON.stringify(body), /\d{4}-\d{2}-\d{2}/);
});

test("the call site builds the body through the contract rather than inline", () => {
  const source = readFileSync(new URL("../lib/hotel-recommendations-client.ts", import.meta.url), "utf8");
  const request = source.slice(source.indexOf("export async function requestHotelRanking"));
  assert.match(request, /body: JSON\.stringify\(buildHotelRankingPayload\(input, locale\)\)/);
  assert.doesNotMatch(request.slice(0, request.indexOf("catch")), /destination: input\.destination/, "no second inline copy of the body");
});
