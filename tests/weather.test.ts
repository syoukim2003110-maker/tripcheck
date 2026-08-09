import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { BuiltTripPlan } from "../lib/trip-builder.ts";
import {
  fetchTripWeather,
  parseWeatherRequest,
  weatherKindForCode,
  type WeatherRequest,
} from "../lib/weather.ts";
import { buildWeatherPayload, requestWeatherPayload } from "../lib/weather-client.ts";

const now = new Date("2026-08-06T00:00:00.000Z");

// App routes use bundler-style extensionless imports. This narrow test hook
// lets Node's type-stripping runner load the real handler without changing the
// production import or introducing a second implementation in the test.
const routeHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../../../lib/weather" && context.parentURL?.endsWith("/app/api/weather/route.ts")) {
      return nextResolve(new URL("../lib/weather.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { POST: postWeather } = await import(new URL("../app/api/weather/route.ts", import.meta.url).href) as {
  POST(request: Request): Promise<Response>;
};
routeHooks.deregister();

test("validates weather requests, coordinate bounds, batch size, and forecast horizon", () => {
  const valid = {
    days: [{ index: 0, date: "2026-08-06", latitude: 35.6762, longitude: 139.6503 }],
  };

  assert.deepEqual(parseWeatherRequest(valid, now), valid);
  assert.ok(parseWeatherRequest({
    days: Array.from({ length: 10 }, (_, index) => ({
      index,
      date: "2026-08-06",
      latitude: index === 0 ? -90 : 35 + index / 100,
      longitude: index === 0 ? 180 : 139 + index / 100,
    })),
  }, now));

  const invalidRequests: unknown[] = [
    null,
    {},
    { days: [] },
    { days: Array.from({ length: 11 }, (_, index) => ({ ...valid.days[0], index })) },
    { days: [null] },
    { days: [{ ...valid.days[0], index: -1 }] },
    { days: [{ ...valid.days[0], index: 31 }] },
    { days: [{ ...valid.days[0], index: 0.5 }] },
    { days: [{ ...valid.days[0], date: "August 6" }] },
    { days: [{ ...valid.days[0], date: "2026-08-32" }] },
    { days: [{ ...valid.days[0], date: "2026-08-03" }] },
    { days: [{ ...valid.days[0], date: "2026-08-22" }] },
    { days: [{ ...valid.days[0], latitude: -90.01 }] },
    { days: [{ ...valid.days[0], latitude: Number.NaN }] },
    { days: [{ ...valid.days[0], longitude: 180.01 }] },
    { days: [{ ...valid.days[0], longitude: "139.65" }] },
  ];
  invalidRequests.forEach((request) => assert.equal(parseWeatherRequest(request, now), null));

  assert.ok(parseWeatherRequest({ days: [{ ...valid.days[0], date: "2026-08-04" }] }, now));
  assert.ok(parseWeatherRequest({ days: [{ ...valid.days[0], date: "2026-08-21" }] }, now));

  // A single drifted day is skipped, not fatal to the sibling days.
  assert.deepEqual(parseWeatherRequest({
    days: [valid.days[0], { ...valid.days[0], index: 1, date: "2026-08-22" }],
  }, now), valid);

  // Keep the impossible date inside the otherwise-valid forecast window so
  // this specifically covers calendar validation rather than horizon expiry.
  assert.equal(parseWeatherRequest({
    days: [{ ...valid.days[0], date: "2026-04-31" }],
  }, new Date("2026-04-30T00:00:00.000Z")), null);
});

test("groups WMO interpretation codes without inventing an unknown condition", () => {
  const cases = [
    [0, "clear"],
    [1, "partly"],
    [2, "partly"],
    [3, "cloudy"],
    [45, "fog"],
    [48, "fog"],
    [51, "rain"],
    [67, "rain"],
    [80, "rain"],
    [82, "rain"],
    [71, "snow"],
    [77, "snow"],
    [85, "snow"],
    [86, "snow"],
    [95, "storm"],
    [99, "storm"],
    [-1, "cloudy"],
    [50, "cloudy"],
    [100, "cloudy"],
  ] as const;

  cases.forEach(([code, expected]) => assert.equal(weatherKindForCode(code), expected));
});

test("requests and parses a single Open-Meteo location", async () => {
  const request: WeatherRequest = {
    days: [{ index: 4, date: "2026-08-07", latitude: 35.676234, longitude: 139.650321 }],
  };
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json({
      daily: {
        time: ["2026-08-06", "2026-08-07"],
        weather_code: [3, 1],
        temperature_2m_max: [23, 24.6],
        temperature_2m_min: [17, 18.4],
        precipitation_probability_max: [55, 12],
      },
    });
  };

  const result = await fetchTripWeather(request, fetcher, now);
  const url = new URL(capturedUrl);

  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("latitude"), "35.6762");
  assert.equal(url.searchParams.get("longitude"), "139.6503");
  assert.equal(url.searchParams.get("timezone"), "auto");
  assert.equal(url.searchParams.get("start_date"), "2026-08-07");
  assert.equal(url.searchParams.get("end_date"), "2026-08-07");
  assert.equal(
    url.searchParams.get("daily"),
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  assert.equal(new Headers(capturedInit?.headers).get("Accept"), "application/json");
  assert.ok(capturedInit?.signal instanceof AbortSignal);
  assert.deepEqual(result, {
    provider: "open_meteo",
    fetchedAt: now.toISOString(),
    days: [{
      index: 4,
      date: "2026-08-07",
      code: 1,
      kind: "partly",
      temperatureMaxC: 25,
      temperatureMinC: 18,
      precipitationPercent: 12,
    }],
  });
});

test("maps a multi-location Open-Meteo response back to original day indexes", async () => {
  const request: WeatherRequest = {
    days: [
      { index: 7, date: "2026-08-09", latitude: 46.0207, longitude: 7.7491 },
      { index: 2, date: "2026-08-07", latitude: 64.1466, longitude: -21.9426 },
      { index: 9, date: "2026-08-08", latitude: 37.9838, longitude: 23.7275 },
    ],
  };
  let capturedUrl = "";
  const fetcher: typeof fetch = async (input) => {
    capturedUrl = String(input);
    return Response.json([
      {
        daily: {
          time: ["2026-08-09"],
          weather_code: [95],
          temperature_2m_max: [9.2],
          temperature_2m_min: [1.7],
          precipitation_probability_max: [88],
        },
      },
      {
        daily: {
          time: ["2026-08-07", "2026-08-08"],
          weather_code: [71, 3],
          temperature_2m_max: [4, 5],
          temperature_2m_min: [-1, 0],
          precipitation_probability_max: [null, 20],
        },
      },
      {
        daily: {
          time: ["2026-08-08"],
          weather_code: [0],
          temperature_2m_max: ["31"],
          temperature_2m_min: [22],
          precipitation_probability_max: [0],
        },
      },
    ]);
  };

  const result = await fetchTripWeather(request, fetcher, new Date("2026-08-06T00:01:00.000Z"));
  const url = new URL(capturedUrl);

  assert.equal(url.searchParams.get("latitude"), "46.0207,64.1466,37.9838");
  assert.equal(url.searchParams.get("longitude"), "7.7491,-21.9426,23.7275");
  assert.equal(url.searchParams.get("start_date"), "2026-08-07");
  assert.equal(url.searchParams.get("end_date"), "2026-08-09");
  assert.deepEqual(result.days, [
    {
      index: 7,
      date: "2026-08-09",
      code: 95,
      kind: "storm",
      temperatureMaxC: 9,
      temperatureMinC: 2,
      precipitationPercent: 88,
    },
    {
      index: 2,
      date: "2026-08-07",
      code: 71,
      kind: "snow",
      temperatureMaxC: 4,
      temperatureMinC: -1,
      precipitationPercent: null,
    },
  ]);
});

test("rejects an unsuccessful weather provider response", async () => {
  const request: WeatherRequest = {
    days: [{ index: 0, date: "2026-08-10", latitude: 1.2345, longitude: 2.3456 }],
  };
  await assert.rejects(
    fetchTripWeather(request, async () => new Response(null, { status: 503 }), now),
    /weather_unavailable/,
  );
});

function secretStop(id: string, latitude: number, longitude: number) {
  return {
    stop: {
      id,
      name: `SECRET PLACE ${id}`,
      area: `SECRET AREA ${id}`,
      latitude,
      longitude,
      sourceUrl: `https://secret.invalid/${id}`,
      verifiedAt: "2026-08-06",
      confidence: "medium" as const,
      planningDurationMinutes: 60,
      isAnchor: false,
    },
  };
}

test("builds a bounded coordinate-only payload for dated planned days", () => {
  const plan = {
    days: [
      { date: "2026-08-05", stops: [secretStop("yesterday", 35, 139)] },
      { date: "2026-08-06", stops: [secretStop("today-a", 35.6, 139.6), secretStop("today-b", 35.8, 139.8)] },
      { date: "2026-08-21", stops: [secretStop("horizon", 46, 7)] },
      { date: "2026-08-23", stops: [secretStop("too-late", 64, -21)] },
      { date: null, stops: [secretStop("undated", 34, 135)] },
      { date: "2026-08-07", stops: [] },
      { date: "not-a-date", stops: [secretStop("invalid-date", 37, 23)] },
    ],
  } as unknown as BuiltTripPlan;

  const payload = buildWeatherPayload(plan, now);

  assert.ok(payload);
  assert.deepEqual(payload.days.map(({ index, date }) => ({ index, date })), [
    { index: 0, date: "2026-08-05" },
    { index: 1, date: "2026-08-06" },
    { index: 2, date: "2026-08-21" },
  ]);
  assert.deepEqual(payload.days[1], {
    index: 1,
    date: "2026-08-06",
    latitude: 35.7,
    longitude: 139.7,
  });
  payload.days.forEach((day) => {
    assert.deepEqual(Object.keys(day).sort(), ["date", "index", "latitude", "longitude"]);
  });
  assert.doesNotMatch(JSON.stringify(payload), /SECRET|PLACE|AREA|secret\.invalid|today-a|today-b/);
});

test("caps the client weather payload at ten days and returns null without eligible days", () => {
  const manyDaysPlan = {
    days: Array.from({ length: 12 }, (_, index) => ({
      date: `2026-08-${String(6 + index).padStart(2, "0")}`,
      stops: [secretStop(`day-${index}`, 30 + index / 10, 130 + index / 10)],
    })),
  } as unknown as BuiltTripPlan;
  assert.equal(buildWeatherPayload(manyDaysPlan, now)?.days.length, 10);

  const noEligibleDays = {
    days: [
      { date: null, stops: [secretStop("undated", 35, 139)] },
      { date: "2026-08-06", stops: [] },
      { date: "2027-01-01", stops: [secretStop("future", 35, 139)] },
    ],
  } as unknown as BuiltTripPlan;
  assert.equal(buildWeatherPayload(noEligibleDays, now), null);
});

test("client posts only the weather payload and maps valid response days by plan index", async () => {
  const payload: WeatherRequest = {
    days: [{ index: 3, date: "2026-08-08", latitude: 35.7, longitude: 139.7 }],
  };
  const originalFetch = globalThis.fetch;
  let capturedInput = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedInput = String(input);
    capturedInit = init;
    return Response.json({
      provider: "open_meteo",
      fetchedAt: now.toISOString(),
      days: [{
        index: 3,
        date: "2026-08-08",
        code: 80,
        kind: "rain",
        temperatureMaxC: 28,
        temperatureMinC: 21,
        precipitationPercent: 75,
      }],
    });
  }) as typeof fetch;
  try {
    const result = await requestWeatherPayload(payload);
    assert.equal(capturedInput, "/api/weather");
    assert.equal(capturedInit?.method, "POST");
    assert.equal(new Headers(capturedInit?.headers).get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), payload);
    assert.equal(result[3]?.kind, "rain");
    assert.deepEqual(Object.keys(result), ["3"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client weather enrichment fails closed on network, HTTP, and payload errors", async () => {
  const payload: WeatherRequest = {
    days: [{ index: 0, date: "2026-08-08", latitude: 10.1234, longitude: 20.1234 }],
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.deepEqual(await requestWeatherPayload(payload), {});

    globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
    assert.deepEqual(await requestWeatherPayload(payload), {});

    globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    assert.deepEqual(await requestWeatherPayload(payload), {});

    globalThis.fetch = (async () => Response.json({ days: "not-an-array" })) as typeof fetch;
    assert.deepEqual(await requestWeatherPayload(payload), {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const weatherApiUrl = "https://tripcheck.test/api/weather";

function weatherApiRequest(
  body: unknown,
  headers: Record<string, string> = {},
  rawBody = false,
) {
  return new Request(weatherApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tripcheck.test",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: rawBody ? String(body) : JSON.stringify(body),
  });
}

function currentWeatherApiPayload(latitude: number, longitude: number): WeatherRequest {
  return {
    days: [{
      index: 0,
      date: new Date().toISOString().slice(0, 10),
      latitude,
      longitude,
    }],
  };
}

test("weather API accepts same-origin requests and rejects cross-origin or cross-site calls", async () => {
  const payload = currentWeatherApiPayload(-44.1234, 170.5678);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return Response.json({
      daily: {
        time: [payload.days[0].date],
        weather_code: [2],
        temperature_2m_max: [13],
        temperature_2m_min: [4],
        precipitation_probability_max: [20],
      },
    });
  }) as typeof fetch;
  try {
    const foreignOrigin = await postWeather(weatherApiRequest(payload, {
      Origin: "https://attacker.invalid",
      "Sec-Fetch-Site": "cross-site",
    }));
    assert.equal(foreignOrigin.status, 403);
    assert.deepEqual(await foreignOrigin.json(), { code: "forbidden" });

    const conflictingFetchMetadata = await postWeather(weatherApiRequest(payload, {
      "Sec-Fetch-Site": "cross-site",
    }));
    assert.equal(conflictingFetchMetadata.status, 403);
    assert.deepEqual(await conflictingFetchMetadata.json(), { code: "forbidden" });
    assert.equal(providerCalls, 0);

    const sameOrigin = await postWeather(weatherApiRequest(payload));
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get("Cache-Control"), "no-store, max-age=0");
    const result = await sameOrigin.json() as { provider: string; days: Array<{ kind: string }> };
    assert.equal(result.provider, "open_meteo");
    assert.equal(result.days[0]?.kind, "partly");
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weather API maps malformed JSON and invalid payloads to 400", async () => {
  const malformed = await postWeather(weatherApiRequest("{", {}, true));
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.deepEqual(await malformed.json(), { code: "invalid_request" });

  const invalid = await postWeather(weatherApiRequest({ days: [] }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { code: "invalid_request" });
});

test("weather API maps upstream provider failures to 502", async () => {
  const payload = currentWeatherApiPayload(-54.4321, 3.2109);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(null, { status: 503 });
  }) as typeof fetch;
  try {
    const response = await postWeather(weatherApiRequest(payload));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), { code: "unavailable" });
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
