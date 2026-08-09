import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { BuiltTripPlan } from "../lib/trip-builder.ts";
import { fetchTripHolidays, parseHolidaysRequest, type HolidaysRequest } from "../lib/holidays.ts";
import { buildHolidaysPayload } from "../lib/holidays-client.ts";

const now = new Date("2026-08-06T00:00:00.000Z");

// Same narrow resolver as weather.test.ts: lets Node's type-stripping runner
// load the route handler despite its bundler-style extensionless import.
const routeHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../../../lib/holidays" && context.parentURL?.endsWith("/app/api/holidays/route.ts")) {
      return nextResolve(new URL("../lib/holidays.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { POST: postHolidays } = await import(new URL("../app/api/holidays/route.ts", import.meta.url).href) as {
  POST(request: Request): Promise<Response>;
};
routeHooks.deregister();

function planWithDates(dates: Array<string | null>): BuiltTripPlan {
  return {
    days: dates.map((date, index) => ({
      label: `Day ${index + 1}`,
      date,
      stops: [],
      legs: [],
      startTime: "09:00",
      finishTime: "18:00",
    })),
  } as unknown as BuiltTripPlan;
}

test("parseHolidaysRequest accepts a clean request and dedupes dates", () => {
  const parsed = parseHolidaysRequest({
    countryCode: "CH",
    dates: ["2026-08-15", "2026-08-15", "2026-08-16"],
  }, now);
  assert.deepEqual(parsed, { countryCode: "CH", dates: ["2026-08-15", "2026-08-16"] });
});

test("parseHolidaysRequest rejects bad country codes, bad dates and far years", () => {
  assert.equal(parseHolidaysRequest({ countryCode: "ch", dates: ["2026-08-15"] }, now), null);
  assert.equal(parseHolidaysRequest({ countryCode: "CHE", dates: ["2026-08-15"] }, now), null);
  assert.equal(parseHolidaysRequest({ countryCode: "CH", dates: [] }, now), null);
  assert.equal(parseHolidaysRequest({ countryCode: "CH", dates: ["2026-02-30"] }, now), null);
  assert.equal(parseHolidaysRequest({ countryCode: "CH", dates: ["2026-8-15"] }, now), null);
  // One bad date poisons the request rather than being silently dropped.
  assert.equal(parseHolidaysRequest({ countryCode: "CH", dates: ["2026-08-15", "nope"] }, now), null);
  assert.equal(parseHolidaysRequest({ countryCode: "CH", dates: ["2031-01-01"] }, now), null);
  assert.equal(parseHolidaysRequest({ countryCode: "CH", dates: ["2024-01-01"] }, now), null);
  const cap = Array.from({ length: 32 }, (_, i) => `2026-08-${String((i % 28) + 1).padStart(2, "0")}`);
  assert.equal(parseHolidaysRequest({ countryCode: "CH", dates: cap }, now), null);
});

test("fetchTripHolidays keeps only Public holidays landing on requested dates", async () => {
  const request: HolidaysRequest = { countryCode: "CH", dates: ["2026-08-01", "2026-08-15"] };
  const fetcher = (async (url: RequestInfo | URL) => {
    assert.equal(String(url), "https://date.nager.at/api/v3/PublicHolidays/2026/CH");
    return Response.json([
      { date: "2026-08-01", localName: "Bundesfeier", name: "National Day", global: true, types: ["Public"] },
      { date: "2026-08-15", localName: "Mariä Himmelfahrt", name: "Assumption Day", global: false, types: ["Public"] },
      { date: "2026-08-01", localName: "Duplicate", name: "Duplicate", global: true, types: ["Public"] },
      { date: "2026-08-15", localName: "School day", name: "School day", global: true, types: ["School"] },
      { date: "2026-12-25", localName: "Weihnachten", name: "Christmas Day", global: true, types: ["Public"] },
      { date: "2026-08-15", localName: 42, name: "Broken", global: true, types: ["Public"] },
    ]);
  }) as typeof fetch;
  const result = await fetchTripHolidays(request, fetcher);
  assert.deepEqual(result.holidays, [
    { date: "2026-08-01", localName: "Bundesfeier", name: "National Day", nationwide: true },
    { date: "2026-08-15", localName: "Mariä Himmelfahrt", name: "Assumption Day", nationwide: false },
  ]);
});

test("fetchTripHolidays queries each year once for a year-spanning trip", async () => {
  const seen: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => {
    seen.push(String(url));
    return Response.json([]);
  }) as typeof fetch;
  await fetchTripHolidays({ countryCode: "JP", dates: ["2026-12-31", "2027-01-01", "2027-01-02"] }, fetcher);
  assert.deepEqual(seen, [
    "https://date.nager.at/api/v3/PublicHolidays/2026/JP",
    "https://date.nager.at/api/v3/PublicHolidays/2027/JP",
  ]);
});

test("fetchTripHolidays treats 404 as no data and other failures as unavailable", async () => {
  const notFound = (async () => new Response("", { status: 404 })) as typeof fetch;
  const result = await fetchTripHolidays({ countryCode: "XX", dates: ["2026-08-15"] }, notFound);
  assert.deepEqual(result, { holidays: [] });

  const flaky = (async () => new Response("", { status: 500 })) as typeof fetch;
  await assert.rejects(
    () => fetchTripHolidays({ countryCode: "CH", dates: ["2026-08-15"] }, flaky),
    /holidays_unavailable/,
  );
  const garbled = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => fetchTripHolidays({ countryCode: "CH", dates: ["2026-08-15"] }, garbled),
    /holidays_unavailable/,
  );
});

test("buildHolidaysPayload sends bare dates for the primary country only", () => {
  const plan = planWithDates(["2026-08-15", null, "2026-08-16", "2026-08-15"]);
  assert.deepEqual(buildHolidaysPayload(plan, "CH"), {
    countryCode: "CH",
    dates: ["2026-08-15", "2026-08-16"],
  });
  assert.equal(buildHolidaysPayload(plan, null), null);
  assert.equal(buildHolidaysPayload(plan, "ch"), null);
  assert.equal(buildHolidaysPayload(planWithDates([null, null]), "CH"), null);
});

test("holidays route rejects malformed bodies", async () => {
  const response = await postHolidays(new Request("http://localhost/api/holidays", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryCode: "CH", dates: ["never"] }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: "invalid_request" });
});
