import assert from "node:assert/strict";
import test from "node:test";
import { parseProductEvent } from "../lib/product-analytics.ts";
import { POST } from "../app/api/product-events/route.ts";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/product-events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", "Sec-Fetch-Site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });
}

test("accepts only aggregate allowlisted funnel fields", () => {
  assert.deepEqual(parseProductEvent({
    event: "provisional_result_shown",
    fields: { place_count: 8.4, trip_day_count: 3, result_state: "PROVISIONAL_FEASIBLE" },
  }), {
    event: "provisional_result_shown",
    fields: { place_count: 8, trip_day_count: 3, result_state: "PROVISIONAL_FEASIBLE" },
  });
  assert.equal(parseProductEvent({ event: "places_parsed", fields: { rawText: "hotel and itinerary" } }), null);
  assert.equal(parseProductEvent({ event: "places_parsed", fields: { place_name: "Senso-ji" } }), null);
  assert.equal(parseProductEvent({ event: "places_parsed", fields: { error_code: "network failed: Senso-ji" } }), null);
});

test("v1.1 funnel additions stay aggregate-only", () => {
  assert.deepEqual(parseProductEvent({ event: "plan_edited", fields: { edit_type: "move_day" } }), {
    event: "plan_edited",
    fields: { edit_type: "move_day" },
  });
  assert.deepEqual(parseProductEvent({ event: "gap_accepted", fields: { provider_name: "google" } }), {
    event: "gap_accepted",
    fields: { provider_name: "google" },
  });
  assert.deepEqual(parseProductEvent({ event: "undo_used", fields: {} }), { event: "undo_used", fields: {} });
  // Free text can never ride along on the new events.
  assert.equal(parseProductEvent({ event: "plan_edited", fields: { edit_type: "renamed Senso-ji" } }), null);
  assert.equal(parseProductEvent({ event: "hotel_accepted", fields: { hotel_name: "Alpina" } }), null);
});

test("event route rejects cross-origin and PII before logging", async () => {
  let logs = 0;
  const original = console.info;
  console.info = () => { logs += 1; };
  try {
    const crossOrigin = await POST(request({ event: "trip_input_started", fields: {} }, { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }));
    assert.equal(crossOrigin.status, 403);
    const pii = await POST(request({ event: "places_resolved", fields: { hotel: "secret" } }));
    assert.equal(pii.status, 400);
    assert.equal(logs, 0);
  } finally {
    console.info = original;
  }
});

test("event route logs one sanitized operational record", async () => {
  const captured: string[] = [];
  const original = console.info;
  console.info = (...values: unknown[]) => { captured.push(values.map(String).join(" ")); };
  try {
    const response = await POST(request({
      event: "live_verification_completed",
      fields: { verified_count: 12, unknown_count: 2, provider_name: "google" },
    }));
    assert.equal(response.status, 202);
    assert.equal(captured.length, 1);
    assert.match(captured[0], /live_verification_completed/);
    assert.doesNotMatch(captured[0], /itinerary|hotel|address|reservation/);
  } finally {
    console.info = original;
  }
});
