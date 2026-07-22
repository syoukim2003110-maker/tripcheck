import assert from "node:assert/strict";
import test from "node:test";
import { decodeTripShare, encodeTripShare, type ShareableTripInput } from "../lib/share-link.ts";

const input: ShareableTripInput = {
  itinerary: "1日目\n浅草寺\nチームラボプラネッツ 15:30 予約",
  tripDays: 3,
  tripStartDate: "2026-09-14",
  hotelQuery: "新宿駅近く",
  pace: "balanced",
  mealPlan: "all",
  travelPreference: "car",
  arrivalAirport: "HND",
  arrivalTime: "10:30",
  departureAirport: "none",
  departureTime: "",
  dayStartDefault: "08:00",
  dayEndTarget: "21:30",
};

test("a share link round-trips every input, including Japanese text", () => {
  const code = encodeTripShare(input);
  assert.match(code, /^[A-Za-z0-9_-]+$/, "URL-hash safe");
  assert.deepEqual(decodeTripShare(code), input);
});

test("garbage and hostile share payloads are rejected or clamped", () => {
  assert.equal(decodeTripShare("not-base64!!"), null);
  assert.equal(decodeTripShare(encodeTripShare({ ...input, itinerary: "   " })), null);

  const oversized = decodeTripShare(encodeTripShare({
    ...input,
    tripDays: 99,
    pace: "hyperspeed" as ShareableTripInput["pace"],
    arrivalAirport: "LAX",
    arrivalTime: "99:99",
  }));
  assert.ok(oversized);
  assert.equal(oversized.tripDays, 10);
  assert.equal(oversized.pace, "balanced");
  assert.equal(oversized.arrivalAirport, "none");
  assert.equal(oversized.arrivalTime, "");
});
