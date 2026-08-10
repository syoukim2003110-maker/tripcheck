import assert from "node:assert/strict";
import test from "node:test";
import { LiveRoutesError } from "../lib/planning-live-routes-client.ts";
import { straightLineDistanceKm } from "../lib/route-optimizer.ts";
import {
  buildPlanningRouteLegs,
  buildPlanningTransitIteration,
  buildSelectedTransitLegRequests,
  fetchPlanningTransitEvidence,
  planningRouteRequestKey,
  prefetchPlanningRouteDurations,
} from "../lib/planning-live-routes-client.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";

function swissMountainStops() {
  return [
    {
      id: "zermatt",
      input: "Zermatt",
      inputIndex: 0,
      name: "Zermatt",
      area: "Zermatt",
      address: "Zermatt, Switzerland",
      latitude: 46.0207,
      longitude: 7.7491,
      sourceUrl: "https://example.com/zermatt",
      verifiedAt: "2026-08-09T00:00:00Z",
      confidence: "medium" as const,
      planningDurationMinutes: 60,
      isAnchor: false,
      countryCode: "CH",
    },
    {
      id: "gornergrat",
      input: "Gornergrat",
      inputIndex: 1,
      name: "Gornergrat",
      area: "Zermatt",
      address: "Gornergrat, Switzerland",
      latitude: 45.9834,
      longitude: 7.7847,
      sourceUrl: "https://example.com/gornergrat",
      verifiedAt: "2026-08-09T00:00:00Z",
      confidence: "medium" as const,
      planningDurationMinutes: 120,
      isAnchor: false,
      countryCode: "CH",
    },
  ];
}

function swissMountainDraft() {
  return buildTripFromWishlist("Zermatt\nGornergrat", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    resolvedStops: swissMountainStops(),
    lockedOrderByDay: { 0: ["zermatt", "gornergrat"] },
    transferBufferMinutes: 0,
  });
}

test("builds hotel and stop legs with every mode contender that could win", () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const legs = buildPlanningRouteLegs(draft);

  const ids = new Set(legs.map((leg) => leg.id));
  assert.equal(ids.size, 3, "three physical legs");
  // Google-Maps-style comparison: transit is always measured; the short
  // Senso-ji → Skytree hop also races walking; the longer hotel legs race a car.
  for (const id of ids) {
    assert.ok(legs.some((leg) => leg.id === id && leg.mode === "transit"), `${id} must include transit`);
  }
  assert.ok(legs.some((leg) => leg.mode === "walk"), "a short hop races walking");
  assert.ok(legs.some((leg) => leg.mode === "drive"), "a long hotel leg races a car");
  assert.match(legs[0].id, /^base-shinjuku::(?:sensoji|tokyo-skytree)$/);
  assert.match(legs[0].departureTime, /^2026-09-14T\d{2}:\d{2}:00\+09:00$/);
  assert.deepEqual(Object.keys(legs[0]).sort(), ["departureTime", "destination", "id", "mode", "origin"]);
});

test("mountain transit uses a distinct access-node endpoint and discloses the assumption", async () => {
  const draft = swissMountainDraft();
  const [leg] = buildPlanningRouteLegs(draft);
  const [request] = buildSelectedTransitLegRequests(draft);

  assert.ok(leg);
  assert.equal(leg.id, "zermatt::gornergrat", "the logical itinerary leg keeps the summit id");
  assert.equal(leg.mode, "transit");
  assert.deepEqual(leg.destination, { latitude: 46.023889, longitude: 7.748889 });
  assert.match(leg.routingEndpointKey ?? "", /access-node:gornergrat:didok-8501690/);
  assert.equal(leg.accessAssumptions?.[0].mountainStopId, "gornergrat");
  assert.equal(leg.accessAssumptions?.[0].accessNodeName, "Zermatt GGB station");
  assert.equal(draft.days[0].stops[1].stop.name, "Gornergrat");
  assert.deepEqual(request.destination, leg.destination);
  assert.equal(request.legId, leg.id);
  assert.match(request.requestKey, /access-node%3Agornergrat%3Adidok-8501690/);
  assert.equal(buildPlanningRouteLegs(draft).some((candidate) => candidate.mode === "walk" || candidate.mode === "drive"), false);

  let providerDestination: unknown;
  const [evidence] = await fetchPlanningTransitEvidence([request], "en", {
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { legs: Array<{ destination: unknown }> };
      providerDestination = body.legs[0].destination;
      return Response.json({
        provider: "google_maps",
        fetchedAt: "2026-08-09T00:00:00.000Z",
        legs: [{
          id: "transit-0",
          status: "ok",
          durationMinutes: 12,
          transferCount: 0,
          distanceMeters: 300,
          encodedPolyline: null,
        }],
      });
    },
  });
  assert.deepEqual(providerDestination, { latitude: 46.023889, longitude: 7.748889 });
  assert.equal(evidence.providerRef, "google_maps:access_node:didok-8501690");
  assert.equal(evidence.status, "verified", "the access-node segment itself is verified, not the full summit journey");
});

test("convergence requests cover selected transit legs and plausible-transit taxi legs", () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const requests = buildSelectedTransitLegRequests(draft);
  const iteration = buildPlanningTransitIteration(draft);
  // Transit is measured for the legs the schedule uses AND for taxi legs of
  // rail-plausible length, so a leg demoted on estimates can earn its transit
  // measurement back instead of staying taxi forever.
  const measuresTransit = (mode: string | null, from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) => (
    mode === "transit" || (mode === "taxi" && straightLineDistanceKm(from as never, to as never) >= 4)
  );
  const selectedTransitFacts = new Set([
    ...draft.days.flatMap((day) => day.legs
      .filter((leg) => measuresTransit(leg.comparison.recommended.mode, leg.from, leg.to))
      .map((leg) => `route:${day.label}:${leg.from.id}:${leg.to.id}`)),
    ...draft.days.flatMap((day) => day.startBase && day.stops[0] && measuresTransit(day.hotelOutboundMode, day.startBase, day.stops[0].stop)
      ? [`route:${day.label}:${day.startBase.id}:${day.stops[0].stop.id}`]
      : []),
    ...draft.days.flatMap((day) => day.endBase && day.stops.at(-1) && measuresTransit(day.hotelInboundMode, day.stops.at(-1)!.stop, day.endBase)
      ? [`route:${day.label}:${day.stops.at(-1)!.stop.id}:${day.endBase.id}`]
      : []),
  ]);

  assert.ok(requests.length > 0);
  assert.ok(requests.every((request) => request.mode === "transit"));
  assert.deepEqual(new Set(requests.flatMap((request) => request.factIds)), selectedTransitFacts);
  assert.ok(requests.every((request) => request.requestKey.includes(encodeURIComponent(request.legId))));
  assert.ok(requests.every((request) => request.departureBucket.endsWith("Z")));
  assert.match(iteration.signature, /@2026-09-14T/);
});

test("transit provider adapter preserves separate request keys for one physical pair", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nteamLab Planets", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
  });
  const source = buildSelectedTransitLegRequests(draft)[0];
  assert.ok(source);
  const requests = [
    source,
    {
      ...source,
      departureTime: "2026-09-14T11:00:00+09:00",
      departureBucket: "2026-09-14T02:00:00.000Z",
      requestKey: `transit|${encodeURIComponent(source.legId)}|2026-09-14T02:00:00.000Z`,
    },
  ];
  const result = await fetchPlanningTransitEvidence(requests, "en", {
    fetcher: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { legs: Array<{ id: string }> };
      return Response.json({
        provider: "google_maps",
        fetchedAt: "2026-08-09T00:00:00.000Z",
        legs: payload.legs.map((leg, index) => ({
          id: leg.id,
          status: "ok",
          durationMinutes: 18 + index,
          transferCount: index * 2,
          distanceMeters: 1_000,
          encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        })),
      });
    },
  });

  assert.deepEqual(result.map((entry) => entry.requestKey), requests.map((entry) => entry.requestKey));
  assert.deepEqual(result.map((entry) => entry.durationMinutes), [18, 19]);
  assert.deepEqual(result.map((entry) => entry.transferCount), [0, 2]);
  assert.ok(result.every((entry) => entry.providerRef === "google_maps" && entry.status === "verified"));
  assert.ok(result.every((entry) => entry.routeGeometry?.points.length === 3));
  assert.ok(result.every((entry) => entry.routeGeometry?.distanceMeters === 1_000));
});

test("transit provider adapter does not invent a map line when geometry is unavailable", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nteamLab Planets", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
  });
  const request = buildSelectedTransitLegRequests(draft)[0];
  assert.ok(request);
  const [result] = await fetchPlanningTransitEvidence([request], "en", {
    fetcher: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { legs: Array<{ id: string }> };
      return Response.json({
        provider: "google_maps",
        fetchedAt: "2026-08-09T00:00:00.000Z",
        legs: payload.legs.map((leg) => ({
          id: leg.id,
          status: "unavailable",
          durationMinutes: null,
          transferCount: null,
          distanceMeters: null,
          encodedPolyline: null,
        })),
      });
    },
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.durationMinutes, null);
  assert.equal(result.transferCount, null);
  assert.equal(result.routeGeometry, undefined);
});

test("prefetches airport-to-hotel travel at the real post-arrival time", () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    arrivalAirport: "HND",
    arrivalTime: "10:00",
  });
  const airportLeg = buildPlanningRouteLegs(draft).find((leg) => leg.id.startsWith("airport-hnd::"));
  assert.ok(airportLeg);
  assert.equal(airportLeg.mode, "transit");
  assert.equal(airportLeg.departureTime, "2026-09-14T11:30:00+09:00");
  const selectedAirport = buildSelectedTransitLegRequests(draft).find((request) => request.legId === airportLeg.id);
  assert.deepEqual(selectedAirport?.factIds, ["route:airport:arrival:HND"]);
});

test("does not double-shift an airport route after a late arrival rolls the activity day", () => {
  const draft = buildTripFromWishlist("Senso-ji", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    arrivalAirport: "HND",
    arrivalTime: "23:30",
    flightKind: "international",
  });
  const airportLeg = buildPlanningRouteLegs(draft).find((leg) => leg.id.startsWith("airport-hnd::"));

  assert.equal(draft.days[0].date, "2026-09-15");
  assert.ok(airportLeg);
  assert.equal(airportLeg.departureTime, "2026-09-15T01:00:00+09:00");
});

test("keeps an early departure airport route on the previous calendar day", () => {
  const draft = buildTripFromWishlist("Senso-ji", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    departureAirport: "HND",
    departureTime: "02:00",
    flightKind: "international",
  });
  const airportLeg = buildPlanningRouteLegs(draft).find((leg) => leg.id.endsWith("::airport-hnd"));

  assert.ok(airportLeg);
  assert.equal(airportLeg.departureTime, "2026-09-13T22:00:00+09:00");
});

test("prefetches real transit and walking results through the existing endpoint", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const capturedBodies: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = String(init?.body);
    capturedBodies.push(body);
    const payload = JSON.parse(body) as {
      travelMode: "TRANSIT" | "WALK";
      legs: Array<{ id: string }>;
    };
    const durationMinutes = payload.travelMode === "TRANSIT" ? 18 : 42;
    return Response.json({
      provider: "google_maps",
      fetchedAt: payload.travelMode === "TRANSIT" ? "2026-07-21T00:00:00.000Z" : "2026-07-21T00:00:01.000Z",
      travelMode: payload.travelMode,
      legs: payload.legs.map((leg) => ({
        id: leg.id,
        durationMinutes,
        transferCount: payload.travelMode === "TRANSIT" ? 2 : null,
        distanceMeters: 2100,
        status: "ok",
      })),
    });
  };

  const result = await prefetchPlanningRouteDurations(draft, "en", { fetcher, concurrency: 1 });

  assert.equal(capturedBodies.length, 3);
  assert.ok(capturedBodies.some((body) => body.includes('"travelMode":"TRANSIT"')));
  assert.ok(capturedBodies.some((body) => body.includes('"travelMode":"WALK"')));
  assert.ok(capturedBodies.some((body) => body.includes('"travelMode":"DRIVE"')));
  assert.doesNotMatch(capturedBodies.join("\n"), /Senso-ji|Tokyo Skytree|private hotel note/i);
  assert.equal(Object.values(result.transitMinutes)[0], 18);
  assert.equal(result.legs.find((leg) => leg.mode === "transit")?.transferCount, 2);
  assert.equal(Object.values(result.walkingMinutes)[0], 42);
  assert.ok(Object.keys(result.drivingMinutes).length > 0);
  assert.equal(result.legs.length, buildPlanningRouteLegs(draft).length);
  assert.equal(result.fetchedAt, "2026-07-21T00:00:01.000Z");
  assert.equal(result.skippedLegCount, 0);
});

test("caps a trip at twenty route request-events even when a caller asks for more", async () => {
  const draft = buildTripFromWishlist(`Ghibli Museum
Shibuya Sky
Senso-ji
Tokyo Skytree
teamLab Planets
Tsukiji Outer Market
Meiji Jingu
Akihabara
Ueno Park
Tokyo Station
Imperial Palace
Tokyo Tower
Roppongi Hills
Harajuku`, 1, "fast", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const allLegs = buildPlanningRouteLegs(draft);
  assert.ok(allLegs.length > 20);
  let requested = 0;
  const result = await prefetchPlanningRouteDurations(draft, "en", {
    maxLegs: 999,
    fetcher: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { travelMode: string; legs: Array<{ id: string }> };
      requested += payload.legs.length;
      return Response.json({
        provider: "google_maps",
        fetchedAt: "2026-08-09T00:00:00.000Z",
        travelMode: payload.travelMode,
        legs: payload.legs.map((leg) => ({ id: leg.id, durationMinutes: 15, distanceMeters: 1_000, status: "ok" })),
      });
    },
  });

  assert.equal(requested, 20);
  assert.equal(result.skippedLegCount, allLegs.length - 20);
});

test("requires a real trip date instead of inventing a departure", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en");
  await assert.rejects(
    prefetchPlanningRouteDurations(draft, "en", { fetcher: async () => Response.json({}) }),
    (error: unknown) => error instanceof LiveRoutesError && error.code === "missing_date",
  );
});

test("a cancelled build aborts the route prefetch instead of substituting estimates", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const controller = new AbortController();
  controller.abort();
  let sawAbortedSignal = false;
  const fetcher: typeof fetch = async (_input, init) => {
    sawAbortedSignal = init?.signal?.aborted === true;
    throw new DOMException("Aborted", "AbortError");
  };

  await assert.rejects(
    () => prefetchPlanningRouteDurations(draft, "en", { fetcher, signal: controller.signal, concurrency: 1 }),
    LiveRoutesError,
  );
  assert.equal(sawAbortedSignal, true);
});

test("already-measured legs are excluded from a follow-up prefetch", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const allLegs = buildPlanningRouteLegs(draft);
  const excludeKeys = allLegs.slice(0, 2).map(planningRouteRequestKey);
  const requestedIds: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { travelMode: "TRANSIT" | "WALK"; legs: Array<{ id: string }> };
    requestedIds.push(...payload.legs.map((leg) => leg.id));
    return Response.json({
      provider: "google_maps",
      fetchedAt: "2026-07-21T00:00:00.000Z",
      travelMode: payload.travelMode,
      legs: payload.legs.map((leg) => ({ id: leg.id, durationMinutes: 12, distanceMeters: 900, status: "ok" })),
    });
  };

  const result = await prefetchPlanningRouteDurations(draft, "en", { fetcher, concurrency: 1, excludeKeys });
  assert.equal(result.legs.length, allLegs.length - 2);
  for (const excluded of excludeKeys) {
    assert.equal(requestedIds.includes(excluded.split("|")[1]), false);
  }

  const nothingLeft = await prefetchPlanningRouteDurations(draft, "en", {
    fetcher: async () => { throw new Error("must not fetch"); },
    excludeKeys: allLegs.map(planningRouteRequestKey),
  });
  assert.equal(nothingLeft.legs.length, 0);
  assert.equal(nothingLeft.fetchedAt, null);
});

test("a changed departure time is not excluded by an earlier speculative route", async () => {
  const initial = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    dayStartTimes: { 0: "09:00" },
  });
  const shifted = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    dayStartTimes: { 0: "10:00" },
  });
  const initialKeys = buildPlanningRouteLegs(initial).map(planningRouteRequestKey);
  const shiftedLegs = buildPlanningRouteLegs(shifted);
  assert.ok(shiftedLegs.some((leg) => !initialKeys.includes(planningRouteRequestKey(leg))));

  let requested = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { travelMode: "TRANSIT" | "WALK"; legs: Array<{ id: string }> };
    requested += payload.legs.length;
    return Response.json({
      provider: "google_maps",
      fetchedAt: "2026-07-21T00:00:00.000Z",
      travelMode: payload.travelMode,
      legs: payload.legs.map((leg) => ({ id: leg.id, durationMinutes: 14, distanceMeters: 1_000, status: "ok" })),
    });
  };
  await prefetchPlanningRouteDurations(shifted, "en", { fetcher, excludeKeys: initialKeys });
  assert.ok(requested > 0);
});

test("nightly bases produce distinct start and end hotel legs", () => {
  const nightHotel = (id: string, name: string, latitude: number, longitude: number) => ({
    id,
    input: name,
    name,
    area: "Tokyo",
    address: `1 ${name}`,
    latitude,
    longitude,
    sourceUrl: `https://maps.google.com/${id}`,
    verifiedAt: "2026-07-21T00:00:00Z",
    confidence: "medium" as const,
    planningDurationMinutes: 0,
    isAnchor: false,
  });
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree\nMeiji Shrine\nShibuya Crossing\nUeno Park\nGinza", 3, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    nightBases: {
      0: nightHotel("night-0", "Asakusa Stay", 35.711, 139.797),
      1: nightHotel("night-1", "Shibuya Stay", 35.658, 139.7),
    },
  });
  const legs = buildPlanningRouteLegs(draft);
  const ids = legs.map((leg) => leg.id).join("\n");
  assert.match(ids, /base-night-0::/);
  assert.match(ids, /::base-night-1/);
});

test("keeps unavailable provider legs unknown without fabricating minutes or geometry", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const result = await prefetchPlanningRouteDurations(draft, "en", {
    fetcher: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { travelMode: string; legs: Array<{ id: string }> };
      return Response.json({
        provider: "google_maps",
        fetchedAt: "2026-08-09T00:00:00.000Z",
        travelMode: payload.travelMode,
        legs: payload.legs.map((leg) => ({
          id: leg.id,
          durationMinutes: null,
          transferCount: null,
          distanceMeters: null,
          encodedPolyline: null,
          status: "unavailable",
        })),
      });
    },
  });

  assert.ok(result.legs.length > 0);
  assert.ok(result.legs.every((leg) => leg.status === "unavailable" && leg.durationMinutes === null && leg.encodedPolyline === null));
  assert.deepEqual(result.transitMinutes, {});
  assert.deepEqual(result.walkingMinutes, {});
  assert.deepEqual(result.drivingMinutes, {});
});
