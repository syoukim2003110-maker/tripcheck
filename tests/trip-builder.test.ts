import assert from "node:assert/strict";
import test from "node:test";
import { buildTripFromWishlist, routeLegKey } from "../lib/trip-builder.ts";

const wishlist = `Ghibli Museum
Shibuya Sky
Senso-ji
Tokyo Skytree
teamLab Planets
Tsukiji Outer Market
Meiji Jingu
Akihabara`;

test("turns an unordered wishlist into geographically grouped days", () => {
  const plan = buildTripFromWishlist(wishlist, 2, "balanced");

  assert.equal(plan.recognizedStopCount, 8);
  assert.equal(plan.days.length, 2);
  assert.equal(plan.days.flatMap((day) => day.stops).length, 8);
  assert.ok(plan.days.every((day) => day.stops.length === 4));
  assert.ok(plan.days.every((day) => day.googleMapsUrl.includes("travelmode=transit")));
});

test("compares walking, transit and taxi without claiming live routing", () => {
  const plan = buildTripFromWishlist(`Senso-ji\nTokyo Skytree`, 1, "balanced");
  const comparison = plan.days[0].legs[0].comparison;

  assert.deepEqual(comparison.options.map((option) => option.mode), ["walk", "transit", "taxi"]);
  assert.equal(comparison.recommended.mode, "walk");
  assert.ok(comparison.options.every((option) => option.minutes > 0));
  assert.match(plan.days[0].legs[0].googleMapsUrls.walk, /travelmode=walking/);
  assert.match(plan.days[0].legs[0].googleMapsUrls.transit, /travelmode=transit/);
  assert.match(plan.days[0].legs[0].googleMapsUrls.taxi, /travelmode=driving/);
});

test("keeps unsupported entries visible for later map resolution", () => {
  const plan = buildTripFromWishlist(`Senso-ji\nA tiny cafe my friend recommended\nShibuya`, 2, "relaxed");

  assert.equal(plan.recognizedStopCount, 2);
  assert.deepEqual(plan.unknownEntries, ["A tiny cafe my friend recommended"]);
});

test("builds the day around a recognised hotel area and ranks alternative bases", () => {
  const plan = buildTripFromWishlist(wishlist, 2, "balanced", "en", { hotelQuery: "hotel near Shinjuku Station" });

  assert.equal(plan.selectedBase?.name, "Shinjuku area");
  assert.equal(plan.hotelResolved, true);
  assert.equal(plan.baseRecommendations.length, 3);
  assert.ok(plan.days.every((day) => day.hotelTravelMinutes !== null));
  assert.ok(plan.days.every((day) => day.googleMapsUrl.includes("travelmode=transit")));
});

test("protects airport processing, city transfer and international departure time", () => {
  const plan = buildTripFromWishlist(`Senso-ji\nTokyo Skytree`, 1, "balanced", "en", {
    hotelQuery: "Ueno hotel",
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    departureAirport: "NRT",
    departureTime: "18:00",
    flightKind: "international",
  });
  const arrival = plan.airportConstraints.find((constraint) => constraint.direction === "arrival")!;
  const departure = plan.airportConstraints.find((constraint) => constraint.direction === "departure")!;

  assert.equal(arrival.cityTime, "12:30");
  assert.equal(arrival.airportMinutes, 90);
  assert.equal(departure.cityTime, "14:15");
  assert.equal(departure.airportMinutes, 120);
  assert.equal(plan.days[0].deadline, "14:15");
});

test("flags a day that runs past the airport departure deadline", () => {
  const plan = buildTripFromWishlist(`Ghibli Museum\nShibuya Sky\nSenso-ji\nTokyo Skytree`, 1, "fast", "en", {
    hotelQuery: "Shinjuku hotel",
    departureAirport: "HND",
    departureTime: "14:00",
    flightKind: "international",
  });

  assert.equal(plan.days[0].deadline, "10:00");
  assert.ok(plan.days[0].deadlineOverrunMinutes > 0);
  assert.equal(plan.scheduleConflictCount, 1);
});

test("keeps the requested trip length even when some days remain open", () => {
  const plan = buildTripFromWishlist(`Senso-ji\nTokyo Skytree`, 5, "relaxed", "en", {
    departureAirport: "HND",
    departureTime: "18:00",
  });

  assert.equal(plan.days.length, 5);
  assert.equal(plan.days.filter((day) => day.stops.length === 0).length, 3);
  assert.equal(plan.days[4].deadline, "14:00");
  assert.equal(plan.days[4].theme, "Open day");
  assert.equal(plan.days[4].googleMapsUrl, null);
});

test("locks a booked stop to its requested day and time", () => {
  const plan = buildTripFromWishlist(`Senso-ji
Ghibli Museum — Day 2 10:00 booked · must
Shibuya Sky`, 3, "balanced");
  const ghibli = plan.days[1].stops.find((stop) => stop.stop.id === "ghibli-museum");

  assert.ok(ghibli);
  assert.equal(ghibli.arrival, "10:00");
  assert.equal(ghibli.fixedTime, "10:00");
  assert.equal(ghibli.priority, "must");
  assert.equal(ghibli.reservationLateMinutes, 0);
  assert.equal(plan.constraintCount, 1);
});

test("reports lateness when airport arrival makes a reservation impossible", () => {
  const plan = buildTripFromWishlist("teamLab Planets — Day 1 12:00 booked", 1, "balanced", "en", {
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    flightKind: "international",
  });

  assert.equal(plan.days[0].stops[0].arrival, "12:30");
  assert.equal(plan.days[0].stops[0].reservationLateMinutes, 30);
  assert.equal(plan.days[0].reservationConflictCount, 1);
  assert.equal(plan.scheduleConflictCount, 1);
});

test("moves optional places to a backup list before breaking the selected pace", () => {
  const plan = buildTripFromWishlist(`Senso-ji
Tokyo Skytree
Akihabara
Shibuya Sky — optional`, 1, "relaxed");

  assert.equal(plan.recognizedStopCount, 4);
  assert.equal(plan.scheduledStopCount, 3);
  assert.deepEqual(plan.deferredOptionalStops.map((stop) => stop.id), ["shibuya-sky"]);
  assert.equal(plan.overCapacityCount, 0);
});

test("understands Japanese day, reservation and priority annotations", () => {
  const plan = buildTripFromWishlist("三鷹の森ジブリ美術館 — 2日目 10:00 予約 · 必須\n浅草寺", 2, "balanced", "ja");
  const ghibli = plan.days[1].stops.find((stop) => stop.stop.id === "ghibli-museum");

  assert.equal(ghibli?.arrival, "10:00");
  assert.equal(ghibli?.priority, "must");
});

test("recalculates the day from a user start time and stay duration", () => {
  const plan = buildTripFromWishlist("Senso-ji", 1, "balanced", "en", {
    dayStartTimes: { 0: "10:30" },
    durationOverrides: { sensoji: 180 },
  });
  const stop = plan.days[0].stops[0];

  assert.equal(plan.days[0].requestedStartTime, "10:30");
  assert.equal(plan.days[0].startTime, "10:30");
  assert.equal(stop.arrival, "10:30");
  assert.equal(stop.departure, "13:30");
  assert.equal(stop.stop.planningDurationMinutes, 180);
});

test("keeps airport arrival as a hard lower bound when a user selects an earlier start", () => {
  const plan = buildTripFromWishlist("Senso-ji", 1, "balanced", "en", {
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    flightKind: "international",
    dayStartTimes: { 0: "08:00" },
  });

  assert.equal(plan.days[0].requestedStartTime, "08:00");
  assert.equal(plan.days[0].startTime, "12:30");
  assert.equal(plan.days[0].startAdjustedByArrival, true);
});

test("attaches real calendar dates to each planned day", () => {
  const plan = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 3, "balanced", "en", {
    tripStartDate: "2026-09-14",
  });

  assert.deepEqual(plan.days.map((day) => day.date), ["2026-09-14", "2026-09-15", "2026-09-16"]);
});

test("uses fresh transit minutes when supplied while preserving estimated alternatives", () => {
  const liveTransitMinutes = {
    [routeLegKey("sensoji", "tokyo-skytree")]: 41,
    [routeLegKey("tokyo-skytree", "sensoji")]: 41,
  };
  const plan = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", { liveTransitMinutes });
  const options = plan.days[0].legs[0].comparison.options;
  const transit = options.find((option) => option.mode === "transit")!;

  assert.equal(transit.minutes, 41);
  assert.equal(transit.source, "live");
  assert.ok(options.filter((option) => option.mode !== "transit").every((option) => option.source === "estimate"));
});

test("suggests lunch and dinner near the route without changing schedule time", () => {
  const plan = buildTripFromWishlist(`Tsukiji Outer Market
teamLab Planets
Senso-ji
Tokyo Skytree`, 1, "fast", "en", {
    mealPlan: "all",
    tripStartDate: "2026-09-19",
  });
  const baseline = buildTripFromWishlist(`Tsukiji Outer Market
teamLab Planets
Senso-ji
Tokyo Skytree`, 1, "fast", "en", { mealPlan: "none", tripStartDate: "2026-09-19" });

  assert.equal(plan.scheduledStopCount, 4);
  assert.equal(plan.mealBreakCount, 0);
  assert.equal(plan.days[0].stops.some((stop) => stop.kind === "meal"), false);
  assert.equal(plan.days[0].totalMinutes, baseline.days[0].totalMinutes);
  assert.deepEqual(plan.foodRecommendationSlots.map((slot) => slot.kind), ["lunch", "dinner"]);
  assert.ok(plan.foodRecommendationSlots.every((slot) => slot.queryIdeas.length === 3));
});

test("can show dinner ideas without suggesting lunch", () => {
  const plan = buildTripFromWishlist(`Senso-ji
Tokyo Skytree
Akihabara
Shibuya Sky`, 1, "fast", "en", { mealPlan: "dinner" });

  assert.deepEqual(plan.foodRecommendationSlots.map((slot) => slot.kind), ["dinner"]);
  assert.equal(plan.days[0].stops.some((stop) => stop.kind === "meal"), false);
});

test("keeps a user-entered restaurant reservation when its area is known", () => {
  const plan = buildTripFromWishlist("Sushi Kaze in Shibuya — Day 1 19:00 booked · must", 1, "balanced", "en");
  const reservation = plan.days[0].stops[0];

  assert.equal(plan.unknownEntries.length, 0);
  assert.equal(reservation.stop.name, "Sushi Kaze in Shibuya");
  assert.equal(reservation.stop.isUserEntered, true);
  assert.equal(reservation.stop.confidence, "low");
  assert.equal(reservation.fixedTime, "19:00");
  assert.equal(reservation.arrival, "19:00");
});

test("raises the crowd planning level by one step on weekends", () => {
  const weekday = buildTripFromWishlist("Senso-ji", 1, "balanced", "en", { tripStartDate: "2026-09-18" });
  const weekend = buildTripFromWishlist("Senso-ji", 1, "balanced", "en", { tripStartDate: "2026-09-19" });
  const rank = { quiet: 0, moderate: 1, busy: 2, veryBusy: 3 } as const;
  const weekdayCrowd = weekday.days[0].stops[0].crowd!;
  const weekendCrowd = weekend.days[0].stops[0].crowd!;

  assert.equal(weekdayCrowd.isWeekend, false);
  assert.equal(weekendCrowd.isWeekend, true);
  assert.equal(weekendCrowd.weekendUplift, 1);
  assert.equal(rank[weekendCrowd.level], rank[weekdayCrowd.level] + 1);
});
