import assert from "node:assert/strict";
import test from "node:test";
import {
  destinationAirport,
  destinationById,
  destinationForCoordinate,
  destinationForCountryCode,
  destinationOptions,
  destinationPlaceQuery,
  destinations,
  isDestinationChoice,
  localDateIn,
  priceBandSymbols,
  withinBounds,
} from "../lib/destinations.ts";
import { fetchGoogleResolvedPlace } from "../lib/google-place-resolver.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { estimateTravelOptions } from "../lib/time-feasibility.ts";

test("every destination profile is internally consistent", () => {
  const ids = new Set<string>();
  const airportCodes = new Map<string, string>();
  for (const destination of destinations) {
    assert.equal(ids.has(destination.id), false, `duplicate id ${destination.id}`);
    ids.add(destination.id);
    assert.ok(destination.names.en.length > 0, `${destination.id} needs an English name`);
    assert.ok(destination.names.ja.length > 0, `${destination.id} needs a Japanese name`);
    assert.match(destination.timeZone, /^[A-Za-z_]+(?:\/[A-Za-z_+-]+)*$/);
    assert.match(destination.currency.code, /^[A-Z]{3}$/);
    assert.ok(destination.meals.lunch.start < destination.meals.lunch.end);
    assert.ok(destination.meals.dinner.start < destination.meals.dinner.end);
    assert.ok(destination.meals.lunch.end <= destination.meals.dinner.start, `${destination.id} meal windows overlap`);
    assert.ok(destination.cuisine.en.length > 0 && destination.cuisine.ja.length > 0);
    if (destination.bounds) {
      assert.ok(destination.bounds.south < destination.bounds.north);
      assert.ok(destination.bounds.west < destination.bounds.east);
      assert.ok(
        withinBounds(destination.bounds, destination.center.latitude, destination.center.longitude),
        `${destination.id} centre falls outside its own bounds`,
      );
    }
    for (const airport of destination.airports) {
      assert.match(airport.code, /^[A-Z]{3}$/);
      // A gateway that is not inside its own country would silently plan the
      // wrong transfer, so the bounds check is the guard rail.
      assert.ok(
        withinBounds(destination.bounds, airport.latitude, airport.longitude),
        `${airport.code} is outside ${destination.id}`,
      );
      assert.ok(airport.transferMinutes > 0 && airport.transferMinutes <= 180);
      assert.ok(airport.internationalDepartureMinutes >= 90);
      assert.match(airport.sourceUrl, /^https:\/\//);
      const owner = airportCodes.get(airport.code);
      assert.equal(owner, undefined, `${airport.code} is listed by both ${owner} and ${destination.id}`);
      airportCodes.set(airport.code, destination.id);
    }
  }
  // Timezones must be real: an invalid zone throws here.
  for (const destination of destinations) localDateIn(destination.timeZone, new Date("2026-08-06T12:00:00Z"));
});

test("a country code or a coordinate names the destination", () => {
  assert.equal(destinationForCountryCode("CH")?.id, "switzerland");
  assert.equal(destinationForCountryCode("jp")?.id, "japan");
  // Ireland must never inherit UK currency, airports or ETA rules.
  assert.equal(destinationForCountryCode("IE"), null);
  assert.equal(destinationForCountryCode("GB")?.id, "uk");
  assert.equal(destinationForCountryCode("ZZ"), null);
  assert.equal(destinationForCountryCode(undefined), null);

  assert.equal(destinationForCoordinate(46.0207, 7.7491)?.id, "switzerland");
  assert.equal(destinationForCoordinate(35.6595, 139.7005)?.id, "japan");
  // Mid-ocean belongs to nobody, and that is reported as unknown, not guessed.
  assert.equal(destinationForCoordinate(0, -140), null);
  assert.equal(destinationForCoordinate(Number.NaN, 0), null);
});

test("an unsupported country with a provider country code stays worldwide", () => {
  const dublin = {
    id: "dublin-castle",
    input: "Dublin Castle",
    name: "Dublin Castle",
    area: "Dublin",
    address: "Dame Street, Dublin, Ireland",
    latitude: 53.343,
    longitude: -6.267,
    sourceUrl: "https://maps.google.com/dublin-castle",
    verifiedAt: "2026-08-08T00:00:00Z",
    confidence: "medium" as const,
    planningDurationMinutes: 90,
    isAnchor: false,
    countryCode: "IE",
  };
  const plan = buildTripFromWishlist("Dublin Castle", 1, "balanced", "en", {
    resolvedStops: [dublin],
  });

  assert.equal(plan.destination, "worldwide");
});

test("unknown or missing ids degrade to the no-assumptions profile", () => {
  assert.equal(destinationById("narnia").id, "worldwide");
  assert.equal(destinationById(undefined).id, "worldwide");
  assert.equal(destinationById("switzerland").id, "switzerland");
  assert.equal(isDestinationChoice("auto"), true);
  assert.equal(isDestinationChoice("switzerland"), true);
  assert.equal(isDestinationChoice("narnia"), false);
});

test("place queries, price bands and airports follow the destination", () => {
  const swiss = destinationById("switzerland");
  const anywhere = destinationById("worldwide");
  assert.equal(destinationPlaceQuery("Old Town", swiss), "Old Town Switzerland");
  // With no country chosen, nothing is appended — a guess would be worse.
  assert.equal(destinationPlaceQuery("Old Town", anywhere), "Old Town");

  assert.deepEqual(priceBandSymbols(destinationById("japan")), ["¥", "¥¥", "¥¥¥", "¥¥¥¥"]);
  assert.deepEqual(priceBandSymbols(swiss), ["₣", "₣₣", "₣₣₣", "₣₣₣₣"]);

  assert.equal(destinationAirport(swiss, "ZRH")?.code, "ZRH");
  assert.equal(destinationAirport(swiss, "none"), null);
  // A code left over from another trip does not apply here.
  assert.equal(destinationAirport(swiss, "HND"), null);
});

test("the picker offers auto first and every country by name", () => {
  const options = destinationOptions("en");
  assert.equal(options[0].value, "auto");
  assert.equal(options.at(-1)?.value, "worldwide");
  assert.ok(options.some((option) => option.value === "switzerland" && option.label === "Switzerland"));
  assert.equal(destinationOptions("ja").some((option) => option.label === "スイス"), true);
});

const swissPlace = (id: string, name: string, latitude: number, longitude: number, minutes: number) => ({
  id,
  input: name,
  name,
  area: name,
  address: `${name}, Switzerland`,
  latitude,
  longitude,
  sourceUrl: `https://maps.google.com/${id}`,
  verifiedAt: "2026-08-01T00:00:00Z",
  confidence: "medium" as const,
  planningDurationMinutes: minutes,
  isAnchor: false,
  countryCode: "CH",
});

const countryPlace = (id: string, name: string, countryCode: string, latitude: number, longitude: number) => ({
  id,
  input: name,
  name,
  area: name,
  address: `${name}, ${countryCode}`,
  latitude,
  longitude,
  sourceUrl: `https://maps.google.com/${id}`,
  verifiedAt: "2026-08-01T00:00:00Z",
  confidence: "medium" as const,
  planningDurationMinutes: 60,
  isAnchor: false,
  countryCode,
});

test("auto destination stays neutral for tied or unsupported mixed-country wishlists", () => {
  const japan = countryPlace("tokyo-place", "Tokyo Place", "JP", 35.68, 139.76);
  const swiss = countryPlace("swiss-place", "Swiss Place", "CH", 46.2, 7.6);
  const dublin = countryPlace("dublin-place", "Dublin Place", "IE", 53.34, -6.27);

  const tied = buildTripFromWishlist("Tokyo Place\nSwiss Place", 2, "balanced", "en", {
    resolvedStops: [japan, swiss],
  });
  const unsupportedMix = buildTripFromWishlist("Tokyo Place\nDublin Place", 2, "balanced", "en", {
    resolvedStops: [japan, dublin],
  });
  const majority = buildTripFromWishlist("Tokyo Place\nTokyo East\nSwiss Place", 2, "balanced", "en", {
    resolvedStops: [
      japan,
      countryPlace("tokyo-east", "Tokyo East", "JP", 35.7, 139.8),
      swiss,
    ],
  });

  assert.equal(tied.destination, "worldwide");
  assert.equal(unsupportedMix.destination, "worldwide");
  assert.equal(majority.destination, "japan");
});

test("a Swiss wishlist is detected, keeps Swiss airports and never suggests Japanese food", () => {
  const plan = buildTripFromWishlist("Jungfraujoch\nLauterbrunnen\nZermatt\nGornergrat", 2, "balanced", "en", {
    tripStartDate: "2026-09-14",
    mealPlan: "all",
    arrivalAirport: "ZRH",
    arrivalTime: "09:30",
    resolvedStops: [
      swissPlace("jungfraujoch", "Jungfraujoch", 46.5474, 7.9853, 150),
      swissPlace("lauterbrunnen", "Lauterbrunnen", 46.5934, 7.9089, 90),
      swissPlace("zermatt", "Zermatt", 46.0207, 7.7491, 120),
      swissPlace("gornergrat", "Gornergrat", 45.9834, 7.7847, 120),
    ],
  });

  assert.equal(plan.destination, "switzerland");
  assert.equal(plan.airportConstraints[0]?.airport, "ZRH");
  const ideas = plan.foodRecommendationSlots.flatMap((slot) => slot.queryIdeas);
  assert.ok(ideas.length > 0);
  assert.equal(ideas.some((idea) => /japanese|izakaya|ramen/i.test(idea)), false);
  assert.ok(ideas.some((idea) => /Swiss|mountain/i.test(idea)));
});

test("a stale Japanese airport is ignored once the trip is Swiss", () => {
  const plan = buildTripFromWishlist("Zermatt\nGornergrat", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    departureAirport: "HND",
    departureTime: "18:00",
    resolvedStops: [
      swissPlace("zermatt", "Zermatt", 46.0207, 7.7491, 120),
      swissPlace("gornergrat", "Gornergrat", 45.9834, 7.7847, 120),
    ],
  });
  assert.equal(plan.destination, "switzerland");
  assert.deepEqual(plan.airportConstraints, []);
});

test("an explicit country overrules where the places actually are", () => {
  const plan = buildTripFromWishlist("Zermatt", 1, "balanced", "en", {
    destination: "japan",
    resolvedStops: [swissPlace("zermatt", "Zermatt", 46.0207, 7.7491, 120)],
  });
  assert.equal(plan.destination, "japan");
});

test("a pinned country rejects a same-name match on the wrong continent", async () => {
  const naplesFlorida = async () => Response.json({
    places: [{
      id: "naples-fl",
      displayName: { text: "Naples" },
      formattedAddress: "Naples, FL 34102, USA",
      addressComponents: [{ types: ["country"], shortText: "US" }],
      location: { latitude: 26.1420, longitude: -81.7948 },
      googleMapsUri: "https://maps.google.com/naples-fl",
      types: ["locality"],
    }],
  });
  assert.equal(
    await fetchGoogleResolvedPlace("Naples", "en", "key", naplesFlorida as typeof fetch, destinationById("italy")),
    null,
  );
  // Without a pinned country the same answer is legitimate and is kept.
  const anywhere = await fetchGoogleResolvedPlace("Naples", "en", "key", naplesFlorida as typeof fetch);
  assert.equal(anywhere?.countryCode, "US");
});

test("the text query and region bias come from the destination", async () => {
  let body: Record<string, unknown> = {};
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      places: [{
        id: "gornergrat",
        displayName: { text: "Gornergrat" },
        formattedAddress: "3920 Zermatt, Switzerland",
        addressComponents: [{ types: ["country"], shortText: "CH" }],
        location: { latitude: 45.9834, longitude: 7.7847 },
        googleMapsUri: "https://maps.google.com/gornergrat",
        types: ["tourist_attraction"],
      }],
    });
  }) as typeof fetch;

  const place = await fetchGoogleResolvedPlace("Gornergrat", "en", "key", fetcher, destinationById("switzerland"));
  assert.equal(body.textQuery, "Gornergrat Switzerland");
  assert.equal(body.regionCode, "CH");
  assert.equal(place?.countryCode, "CH");
  // The country name and the postal code are not a useful area label.
  assert.equal(place?.area, "Zermatt");
});

test("a car-first country stops recommending a train that barely exists", () => {
  const from = {
    id: "a", name: "A", area: "A", latitude: 64.1466, longitude: -21.9426,
    sourceUrl: "https://example.test/a", verifiedAt: "2026-08-01", confidence: "medium" as const,
    planningDurationMinutes: 60, isAnchor: false,
  };
  // ~3 km apart: close enough that a train is worth waiting for where the
  // network is dense, and not where it is not.
  const to = { ...from, id: "b", name: "B", latitude: 64.1766, longitude: -21.9426 };

  assert.equal(estimateTravelOptions(from, to, "auto", "transit_first").recommended.mode, "transit");
  assert.equal(estimateTravelOptions(from, to, "auto", "car_first").recommended.mode, "taxi");
});
