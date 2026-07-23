import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveTransitMinutes, estimateTravelOptions } from "../lib/time-feasibility.ts";
import { estimateStayMinutes, isDayAnchorStay } from "../lib/stay-estimates.ts";
import { buildTripFromWishlist, centroidWithOutlierPull, hotelAnchorForDraft, routeLegKey } from "../lib/trip-builder.ts";
import { buildPlanningRouteLegs, prefetchPlanningRouteDurations } from "../lib/planning-live-routes-client.ts";
import type { ResolvedInputStop } from "../lib/route-optimizer.ts";

function stopAt(id: string, latitude: number, longitude: number, minutes = 90): ResolvedInputStop {
  return {
    id,
    input: id,
    name: id,
    area: "Test",
    address: `1 ${id}`,
    latitude,
    longitude,
    sourceUrl: `https://maps.google.com/${id}`,
    verifiedAt: "now",
    confidence: "medium",
    planningDurationMinutes: minutes,
    isAnchor: false,
  };
}

test("an intercity leg is never a 200-minute taxi crawl", () => {
  // ~90 km straight line (Osaka city → Tango peninsula class).
  const from = stopAt("osaka", 34.69, 135.5);
  const to = stopAt("amanohashidate", 35.5, 135.19);
  const comparison = estimateTravelOptions(from, to);
  const taxi = comparison.options.find((option) => option.mode === "taxi")!;
  const transit = comparison.options.find((option) => option.mode === "transit")!;
  assert.ok(taxi.minutes < 160, `taxi should ride the expressway tier, got ${taxi.minutes}`);
  assert.ok(transit.minutes < 180, `transit should ride the express tier, got ${transit.minutes}`);
  assert.notEqual(comparison.recommended.mode, "walk");
  // The recommendation must stay within ten minutes of the outright fastest option.
  assert.ok(comparison.recommended.minutes <= comparison.fastest.minutes + 10);
});

test("short hops recommend walking, city legs recommend the fastest sane mode", () => {
  const senso = stopAt("senso", 35.7148, 139.7967);
  const skytree = stopAt("skytree", 35.7101, 139.8107);
  assert.equal(estimateTravelOptions(senso, skytree).recommended.mode, "walk");

  const shinjuku = stopAt("shinjuku", 35.6896, 139.7006);
  const asakusa = stopAt("asakusa", 35.7148, 139.7967);
  const city = estimateTravelOptions(shinjuku, asakusa);
  assert.equal(city.recommended.mode, "transit");
  assert.ok(city.recommended.minutes <= city.fastest.minutes + 10);
});

test("the rental-car preference drives every leg except tiny walks", () => {
  const shinjuku = stopAt("shinjuku", 35.6896, 139.7006);
  const asakusa = stopAt("asakusa", 35.7148, 139.7967);
  assert.equal(estimateTravelOptions(shinjuku, asakusa, "car").recommended.mode, "taxi");

  const near = stopAt("near", 35.6896, 139.7006);
  const nearby = stopAt("nearby", 35.6916, 139.7026);
  assert.equal(estimateTravelOptions(near, nearby, "car").recommended.mode, "walk");
});

test("measured Google minutes can flip the recommended mode, like Google Maps", () => {
  const shinjuku = stopAt("shinjuku", 35.6896, 139.7006);
  const asakusa = stopAt("asakusa", 35.7148, 139.7967);
  const estimated = estimateTravelOptions(shinjuku, asakusa);
  assert.equal(estimated.recommended.mode, "transit");

  // Google reports an unusually quick walk (event closure, straight promenade).
  const walkWins = applyLiveTransitMinutes(estimated, 40, 18);
  assert.equal(walkWins.recommended.mode, "walk");
  assert.equal(walkWins.recommended.source, "live");

  // Google reports the car clearly beating the measured train.
  const carWins = applyLiveTransitMinutes(estimated, 38, undefined, 20);
  assert.equal(carWins.recommended.mode, "taxi");
  assert.equal(carWins.recommended.minutes, 20);
});

test("stay estimates size a theme park as a day, not a coffee stop", () => {
  assert.equal(estimateStayMinutes("ユニバーサル・スタジオ・ジャパン", []), 510);
  assert.equal(estimateStayMinutes("USJ", []), 510);
  assert.equal(estimateStayMinutes("Nagoya Port Aquarium", ["aquarium"]), 150);
  assert.equal(estimateStayMinutes("Some Museum", ["museum"]), 120);
  assert.equal(estimateStayMinutes("Totally Unknown", []), 90);
  assert.ok(isDayAnchorStay(510));
  assert.ok(!isDayAnchorStay(150));
});

test("a day-consuming park opens its day and sheds squeezed-in companions", () => {
  const usj = stopAt("usj", 34.6654, 135.4323, 510);
  const castle = stopAt("osaka-castle", 34.6873, 135.5262, 90);
  const dotonbori = stopAt("dotonbori", 34.6687, 135.5013, 75);
  const kaiyukan = stopAt("kaiyukan", 34.6545, 135.4289, 150);
  const shinsekai = stopAt("shinsekai", 34.6525, 135.5063, 75);
  const plan = buildTripFromWishlist("usj\nosaka-castle\ndotonbori\nkaiyukan\nshinsekai", 2, "balanced", "ja", {
    tripStartDate: "2026-09-14",
    resolvedStops: [usj, castle, dotonbori, kaiyukan, shinsekai],
  });
  const usjDay = plan.days.find((day) => day.stops.some(({ stop }) => stop.id === "usj"));
  assert.ok(usjDay, "USJ must be scheduled");
  assert.ok(usjDay!.stops.length <= 2, `USJ's day should not be stuffed, got ${usjDay!.stops.length} stops`);
  assert.equal(usjDay!.stops[0].stop.id, "usj", "the park opens the day instead of closing it");
});

test("a per-leg pick overrides the automatic mode and is always measured", () => {
  const base = {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  };
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", base);
  const leg = draft.days[0].legs[0];
  const legKey = routeLegKey(leg.from.id, leg.to.id);
  assert.notEqual(leg.comparison.recommended.mode, "taxi", "the short hop would never auto-pick a taxi");

  const overridden = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    ...base,
    legModeOverrides: { [legKey]: "taxi" },
  });
  const overriddenLeg = overridden.days[0].legs[0];
  assert.equal(overriddenLeg.comparison.recommended.mode, "taxi");
  // The pruning would skip a taxi on a 1.4 km hop; the user's pick forces the measurement.
  const measuredModes = buildPlanningRouteLegs(overridden)
    .filter((entry) => entry.id === legKey)
    .map((entry) => entry.mode);
  assert.ok(measuredModes.includes("drive"), `expected drive among ${measuredModes.join(",")}`);
});

test("a day-end curfew flags overruns without hiding them; a flight cutoff wins when earlier", () => {
  const curfewed = buildTripFromWishlist("Senso-ji\nTokyo Skytree\nMeiji Shrine\nShibuya Crossing", 1, "fast", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    dayEndTarget: "15:00",
  });
  const day = curfewed.days[0];
  assert.equal(day.deadlineKind, "curfew");
  assert.equal(day.deadline, "15:00");
  assert.ok(day.deadlineOverrunMinutes > 0, "a packed day cannot fit before 15:00");

  const flightWins = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    departureAirport: "HND",
    departureTime: "18:00",
    flightKind: "international",
    dayEndTarget: "23:00",
  });
  assert.equal(flightWins.days[0].deadlineKind, "airport");
});

test("removing a stop rebuilds the plan without it", () => {
  const stops = [
    stopAt("a", 34.66, 135.50),
    stopAt("b", 34.67, 135.51),
    stopAt("c", 34.68, 135.50),
  ];
  const removed = buildTripFromWishlist("a\nb\nc", 1, "balanced", "ja", {
    tripStartDate: "2026-09-14",
    resolvedStops: stops,
    excludedStopIds: ["b"],
  });
  const names = removed.days.flatMap((day) => day.stops.map(({ stop }) => stop.id));
  assert.deepEqual(names.sort(), ["a", "c"]);
  assert.equal(removed.recognizedStopCount, 2);
});

test("the hotel anchor pulls toward a far outlier instead of ignoring it", () => {
  // Four packed stops (Namba-ish) and USJ ~10 km west.
  const cluster = [
    stopAt("d1", 34.6687, 135.5013),
    stopAt("d2", 34.6660, 135.5040),
    stopAt("d3", 34.6700, 135.5060),
    stopAt("d4", 34.6650, 135.5000),
  ];
  const outlier = stopAt("usj", 34.6654, 135.4323);
  const plan = buildTripFromWishlist("d1\nd2\nd3\nd4\nusj", 1, "fast", "ja", {
    tripStartDate: "2026-09-14",
    resolvedStops: [...cluster, outlier],
  });
  const anchor = hotelAnchorForDraft(plan);
  assert.ok(anchor);
  // The anchor must sit clearly between the cluster (~135.50) and USJ (135.43),
  // not inside the cluster.
  assert.ok(anchor.longitude < 135.49 && anchor.longitude > 135.44, `expected in-between, got ${anchor.longitude}`);

  // Without an outlier the anchor is simply the centroid.
  const tight = centroidWithOutlierPull(cluster.map(({ latitude, longitude }) => ({ latitude, longitude })));
  assert.ok(tight && Math.abs(tight.longitude - 135.5028) < 0.01);
});

test("hotel departure and return legs are exposed separately for the timeline", () => {
  const withHotel = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  assert.ok((withHotel.days[0].hotelOutboundMinutes ?? 0) > 0);
  assert.ok((withHotel.days[0].hotelInboundMinutes ?? 0) > 0);
  assert.ok(withHotel.days[0].hotelOutboundMode);
  assert.ok(withHotel.days[0].hotelInboundMode);

  const withoutHotel = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
  });
  assert.equal(withoutHotel.days[0].hotelOutboundMinutes, null);
  assert.equal(withoutHotel.days[0].hotelInboundMinutes, null);
  assert.equal(withoutHotel.days[0].hotelOutboundMode, null);
  assert.equal(withoutHotel.days[0].hotelInboundMode, null);
});

test("a one-tap day move pins the stop to the chosen day", () => {
  const nara = stopAt("todaiji", 34.689, 135.8398);
  const kyotoA = stopAt("kiyomizu", 34.9949, 135.785);
  const kyotoB = stopAt("kinkakuji", 35.0394, 135.7292);
  const shared = { tripStartDate: "2026-09-14", resolvedStops: [nara, kyotoA, kyotoB] };
  const automatic = buildTripFromWishlist("todaiji\nkiyomizu\nkinkakuji", 2, "balanced", "ja", shared);
  const naraDay = automatic.days.findIndex((day) => day.stops.some(({ stop }) => stop.id === "todaiji"));
  const otherDay = naraDay === 0 ? 1 : 0;

  const moved = buildTripFromWishlist("todaiji\nkiyomizu\nkinkakuji", 2, "balanced", "ja", {
    ...shared,
    dayOverrides: { todaiji: otherDay + 1 },
  });
  assert.ok(moved.days[otherDay].stops.some(({ stop }) => stop.id === "todaiji"), "the stop follows the user's pick");
  assert.ok(!moved.days[naraDay].stops.some(({ stop }) => stop.id === "todaiji"));
});

test("the day-rhythm default start applies to every day without a per-day time", () => {
  const plan = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    defaultDayStart: "10:30",
  });
  assert.equal(plan.days[0].startTime, "10:30");

  const perDayWins = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    defaultDayStart: "10:30",
    dayStartTimes: { 0: "08:00" },
  });
  assert.equal(perDayWins.days[0].startTime, "08:00");
});

test("car-preference legs are measured with Google DRIVE routes", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree\nMeiji Shrine", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    travelPreference: "car",
  });
  assert.equal(draft.travelPreference, "car");
  const modes = new Set(buildPlanningRouteLegs(draft).map((leg) => leg.mode));
  assert.ok(modes.has("drive"), `expected drive legs, got ${[...modes].join(",")}`);

  const requestedModes: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { travelMode: string; legs: Array<{ id: string }> };
    requestedModes.push(payload.travelMode);
    return Response.json({
      provider: "google_maps",
      fetchedAt: "2026-07-23T00:00:00.000Z",
      travelMode: payload.travelMode,
      legs: payload.legs.map((leg) => ({ id: leg.id, durationMinutes: 16, distanceMeters: 4_000, status: "ok" })),
    });
  };
  const result = await prefetchPlanningRouteDurations(draft, "en", { fetcher, concurrency: 1 });
  assert.ok(requestedModes.includes("DRIVE"));
  assert.ok(Object.keys(result.drivingMinutes).length > 0);
});
