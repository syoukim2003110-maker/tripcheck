import assert from "node:assert/strict";
import test from "node:test";

import { openCandidate, putPlace } from "../lib/shiori/add-search.ts";
import type { ShioriPlace } from "../lib/shiori/plan.ts";
import {
  appleDataCount,
  applePositions,
  appleRematches,
  atApplePosition,
  canonicalPlaceId,
  decodeTrip,
  emptyTrip,
  keptAppleKind,
  ownPlaces,
  encodeTrip,
  pendingAppleIds,
  placeSource,
  plannableTrip,
  resavedForm,
  tripTitleName,
  withAppleDetails,
  withRematch,
  withoutAppleData,
  withoutRematch,
  type ShioriTrip,
} from "../lib/shiori/state.ts";

/*
 * A place found through Apple Maps is kept in the trip — on the device and
 * in a share link — as its Apple Place ID alone, with what the traveller set
 * (stay, day, meal, booking, the booklet's own kind word). Apple's name,
 * address, category and position of it are looked up again when the trip is
 * opened and live in the page's memory only (Apple Developer Program License
 * Agreement, Attachment 6, 2.5; Place IDs may be kept and shared).
 */

const wireOf = (encoded: string) => JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown> & { s: unknown[][]; h: unknown[] | null };
const linkOf = (wire: unknown) => Buffer.from(JSON.stringify(wire)).toString("base64url");

// Fixtures: the Place IDs are Apple's (a Place ID may be kept); the names and
// positions beside them are Wikidata's (Q191763, Q1200076) or made up, never
// copied from an Apple answer (Apple's name and position may not be kept).
const ITSUKUSHIMA = { id: "I7EA0EDCABFD8E819", name: "厳島神社", latitude: 34.29577, longitude: 132.32011 };
const MUSEUM = { id: "I63802885C8189B2B", name: "広島平和記念資料館", latitude: 34.39147, longitude: 132.45306 };
const HOTEL = { id: "IA1B2C3D4E5F60718", name: "宮島の宿 みやじま", latitude: 34.29718, longitude: 132.32411 };

const applePlace = (from: typeof ITSUKUSHIMA, extra: Partial<ShioriPlace> = {}): ShioriPlace => ({
  id: `apple-${from.id}`, name: from.name, lat: from.latitude, lon: from.longitude, stayMinutes: 60, ...extra,
});

const tripWithApple = (): ShioriTrip => ({
  ...emptyTrip,
  cityId: "hiroshima",
  cityName: "広島",
  days: 2,
  places: [
    { id: "wikidata-Q1", name: "原爆ドーム", lat: 34.39555, lon: 132.45358, stayMinutes: 30, kind: "memorial", img: "Genbaku Dome.jpg" },
    applePlace(ITSUKUSHIMA, { day: 2, kind: "shinto shrine" }),
    applePlace(MUSEUM, { kind: "museum", reserve: { day: 1, time: "10:00" }, day: 1, stayMinutes: 90 }),
    { id: "hotpepper-J000123456", name: "お好み焼き 長田屋", lat: 34.3952, lon: 132.4527, stayMinutes: 60, kind: "restaurant", meal: "lunch" },
    { id: "osm-node-42", name: "縮景園", lat: 34.4006, lon: 132.4673, stayMinutes: 60 },
  ],
  hotel: { name: HOTEL.name, lat: HOTEL.latitude, lon: HOTEL.longitude, id: `apple-${HOTEL.id}` },
});

const appleTexts = [ITSUKUSHIMA, MUSEUM, HOTEL].flatMap((entry) => [entry.name, entry.latitude.toFixed(4), entry.longitude.toFixed(4)]);

test("each stop's source is read from its id, and only Apple's are kept as their Place ID", () => {
  assert.equal(placeSource("apple-I7EA0EDCABFD8E819"), "apple");
  // The open lookup named its Apple hits maps-<id>: the same Apple place.
  assert.equal(placeSource("maps-I7EA0EDCABFD8E819"), "apple");
  assert.equal(canonicalPlaceId("maps-I7EA0EDCABFD8E819"), "apple-I7EA0EDCABFD8E819");
  assert.equal(placeSource("apple-34.29577,132.32011"), "apple-legacy");
  assert.equal(placeSource("maps-34.29577,132.32011"), "apple-legacy");
  assert.equal(placeSource("wikidata-Q1"), "wikidata");
  assert.equal(placeSource("hotpepper-J000123456"), "hotpepper");
  assert.equal(placeSource("osm-node-42"), "osm");
  assert.equal(placeSource(undefined), "other");
});

test("no Apple name, address, category or position is ever in the saved trip or its link", () => {
  const encoded = encodeTrip(tripWithApple());
  const text = Buffer.from(encoded, "base64url").toString("utf8");
  for (const kept of appleTexts) assert.equal(text.includes(kept), false, `${kept} is kept`);
  const wire = wireOf(encoded);
  // Apple stops: the Place ID and the traveller's own settings.
  assert.deepEqual(wire.s[1], ["apple-I7EA0EDCABFD8E819", "", 0, 0, 60, 2, null, null, null]);
  // (Apple's category, even in the booklet's words, is not kept: "museum" came from Apple.)
  assert.deepEqual(wire.s[2], ["apple-I63802885C8189B2B", "", 0, 0, 90, 1, null, null, null, [1, 600]]);
  assert.deepEqual(wire.h, ["", 0, 0, "apple-IA1B2C3D4E5F60718"]);
  // Everyone else's places are kept as they always were.
  assert.deepEqual(wire.s[0], ["wikidata-Q1", "原爆ドーム", 34.39555, 132.45358, 30, null, "memorial", "Genbaku Dome.jpg", null]);
  assert.deepEqual(wire.s[3], ["hotpepper-J000123456", "お好み焼き 長田屋", 34.3952, 132.4527, 60, null, "restaurant", null, "lunch"]);
  assert.deepEqual(wire.s[4], ["osm-node-42", "縮景園", 34.4006, 132.4673, 60, null, null, null, null]);
});

test("whatever a trip in hand holds, its Apple places leave nothing of Apple's in the link (each kind word, each setting)", () => {
  const kinds = ["shinto shrine", "Cafe", "museum", "restaurant", "Apple's own category", "cafe", "theme park"];
  for (const [index, kind] of kinds.entries()) {
    const place = applePlace({ id: `IFAKE${String(index).padStart(11, "0")}`, name: `Apple の名前 ${index}`, latitude: 35.123456 + index, longitude: 139.654321 }, {
      kind, meal: index % 2 ? "dinner" : undefined, day: (index % 3) + 1, img: "Something.jpg", desc: "Apple's words",
    });
    const text = Buffer.from(encodeTrip({ ...emptyTrip, places: [place] }), "base64url").toString("utf8");
    assert.equal(/Apple の名前|35\.12|139\.65|Something\.jpg|Apple's/.test(text), false, text);
    // Only a kind the traveller's own action gave is kept (a meal's restaurant, a break's café); Apple's category never is, in any words.
    const kept = keptAppleKind(kind, index % 2 ? "dinner" : undefined);
    assert.equal(kept === null ? !/"(?:shinto shrine|Cafe|museum|restaurant|Apple's own category|cafe|theme park)"/.test(text) : text.includes(`"${kept}"`), true, `${kind}: ${text}`);
  }
});

test("a new link opens with the same places, the Apple ones waiting for their lookup", () => {
  const trip = tripWithApple();
  const opened = decodeTrip(encodeTrip(trip))!;
  assert.deepEqual(opened.places.map((place) => place.id), trip.places.map((place) => place.id));
  assert.deepEqual(opened.places[1], { id: "apple-I7EA0EDCABFD8E819", name: "", lat: 0, lon: 0, stayMinutes: 60, day: 2, pending: true });
  assert.deepEqual(opened.places[2], { id: "apple-I63802885C8189B2B", name: "", lat: 0, lon: 0, stayMinutes: 90, day: 1, reserve: { day: 1, time: "10:00" }, pending: true });
  assert.deepEqual(opened.hotel, { name: "", lat: 0, lon: 0, id: "apple-IA1B2C3D4E5F60718", pending: true });
  assert.deepEqual(pendingAppleIds(opened), [ITSUKUSHIMA.id, MUSEUM.id, HOTEL.id]);
  // Waiting places are set aside for planning, never removed.
  const usable = plannableTrip(opened);
  assert.deepEqual(usable.places.map((place) => place.id), ["wikidata-Q1", "hotpepper-J000123456", "osm-node-42"]);
  assert.equal(usable.hotel, null);
  assert.equal(opened.places.length, 5);
  // The lookup's answer fills them in, in memory; one Apple did not answer stays waiting.
  const filled = withAppleDetails(opened, new Map([[ITSUKUSHIMA.id, ITSUKUSHIMA], [HOTEL.id, HOTEL]]));
  assert.deepEqual(filled.places[1], { id: "apple-I7EA0EDCABFD8E819", name: "厳島神社", lat: 34.29577, lon: 132.32011, stayMinutes: 60, day: 2 });
  assert.equal(filled.places[2].pending, true);
  assert.deepEqual(filled.hotel, { name: HOTEL.name, lat: HOTEL.latitude, lon: HOTEL.longitude, id: "apple-IA1B2C3D4E5F60718" });
  assert.deepEqual(pendingAppleIds(filled), [MUSEUM.id]);
  // Filling in changes nothing that is kept.
  assert.equal(encodeTrip(filled), encodeTrip(opened));
  assert.equal(encodeTrip(filled), encodeTrip(trip));
});

test("a link made before this change opens with the same places, and is saved again without Apple's data", () => {
  // As the booklet wrote it until now: Apple's name and position beside the id, maps-<id> from the open lookup, a hotel with no id.
  const old = linkOf({
    v: 1, c: "hiroshima", n: "広島", d: 2, p: "standard",
    s: [
      ["wikidata-Q1", "原爆ドーム", 34.39555, 132.45358, 30, null, "memorial", "Genbaku Dome.jpg", null],
      ["apple-I7EA0EDCABFD8E819", "厳島神社", 34.29577, 132.32011, 60, 2, "shinto shrine", null, null],
      ["maps-I63802885C8189B2B", "広島平和記念資料館", 34.39147, 132.45306, 90, null, "museum", null, null, [1, 600]],
      ["apple-IABCDEF0123456789", "お好み村", 34.3925, 132.4612, 90, 1, "restaurant", null, "dinner"],
    ],
    h: ["宮島の宿 みやじま", 34.29718, 132.32411],
  });
  const opened = decodeTrip(old)!;
  assert.deepEqual(opened.places.map((place) => [place.id, place.name, place.stayMinutes, place.day ?? null, place.kind ?? null, place.meal ?? null, place.pending ?? false]), [
    ["wikidata-Q1", "原爆ドーム", 30, null, "memorial", null, false],
    ["apple-I7EA0EDCABFD8E819", "", 60, 2, null, null, true],
    ["apple-I63802885C8189B2B", "", 90, 1, null, null, true],
    ["apple-IABCDEF0123456789", "", 90, 1, "restaurant", "dinner", true],
  ]);
  assert.deepEqual(opened.places[2].reserve, { day: 1, time: "10:00" });
  // A hotel from before hotels had ids is kept as it was until it is found again by name.
  assert.deepEqual(opened.hotel, { name: "宮島の宿 みやじま", lat: 34.29718, lon: 132.32411 });
  assert.deepEqual(appleRematches(opened), [{ key: "hotel", name: "宮島の宿 みやじま", lat: 34.29718, lon: 132.32411 }]);
  // Saved again at once in the new form: Apple's names and positions of its places are gone.
  const resaved = resavedForm(old)!;
  assert.ok(resaved);
  const text = Buffer.from(resaved, "base64url").toString("utf8");
  for (const gone of ["厳島神社", "34.29577", "広島平和記念資料館", "お好み村", "maps-"]) assert.equal(text.includes(gone), false, gone);
  assert.ok(text.includes("原爆ドーム"));
  assert.equal(resavedForm(resaved), null);
  assert.deepEqual(decodeTrip(resaved), opened);
  // Found again under its Place ID, the hotel is kept as that ID too.
  const found = withRematch(opened, "hotel", HOTEL.id, HOTEL);
  assert.deepEqual(wireOf(encodeTrip(found)).h, ["", 0, 0, "apple-IA1B2C3D4E5F60718"]);
});

test("one Apple place under both of its old names is one place; any other repeat still opens nothing", () => {
  const twice = linkOf({ v: 1, c: null, n: "", d: 1, p: "standard", s: [
    ["maps-I7EA0EDCABFD8E819", "厳島神社", 34.29577, 132.32011, 60, null, null, null, null],
    ["apple-I7EA0EDCABFD8E819", "厳島神社", 34.29577, 132.32011, 60, null, null, null, null],
  ], h: null });
  assert.deepEqual(decodeTrip(twice)?.places.map((place) => place.id), ["apple-I7EA0EDCABFD8E819"]);
  const forged = linkOf({ v: 1, c: null, n: "", d: 1, p: "standard", s: [["osm-1", "A", 35, 135, 60, null, null, null], ["osm-1", "A", 35, 135, 60, null, null, null]], h: null });
  assert.equal(decodeTrip(forged), null);
});

test("an Apple stop saved with no Place ID is kept as it was until it is found again by its very name, then kept as the ID", () => {
  const legacy: ShioriTrip = { ...emptyTrip, places: [{ id: "apple-34.29577,132.32011", name: "厳島神社", lat: 34.29577, lon: 132.32011, stayMinutes: 60, day: 1 }] };
  const opened = decodeTrip(encodeTrip(legacy))!;
  assert.deepEqual(opened, legacy);
  assert.deepEqual(appleRematches(opened), [{ key: "apple-34.29577,132.32011", name: "厳島神社", lat: 34.29577, lon: 132.32011 }]);
  const found = withRematch(opened, "apple-34.29577,132.32011", ITSUKUSHIMA.id, ITSUKUSHIMA);
  assert.deepEqual(found.places, [{ id: "apple-I7EA0EDCABFD8E819", name: "厳島神社", lat: 34.29577, lon: 132.32011, stayMinutes: 60, day: 1 }]);
  assert.deepEqual(wireOf(encodeTrip(found)).s, [["apple-I7EA0EDCABFD8E819", "", 0, 0, 60, 1, null, null, null]]);
  assert.deepEqual(appleRematches(found), []);
  // Found again as a place the trip already has: one place, not two.
  const both = { ...opened, places: [...opened.places, applePlace(ITSUKUSHIMA)] };
  assert.deepEqual(withRematch(both, "apple-34.29577,132.32011", ITSUKUSHIMA.id, ITSUKUSHIMA).places.map((place) => place.id), ["apple-I7EA0EDCABFD8E819"]);
});

test("a hotel from the open lookup keeps its name and where it was found", () => {
  const trip: ShioriTrip = { ...emptyTrip, places: [applePlace(MUSEUM)], hotel: { name: "駅前ホテル", lat: 34.3975, lon: 132.4753, id: "osm-node-7" } };
  assert.deepEqual(wireOf(encodeTrip(trip)).h, ["駅前ホテル", 34.3975, 132.4753, "osm-node-7"]);
  assert.deepEqual(decodeTrip(encodeTrip(trip))?.hotel, trip.hotel);
  assert.deepEqual(appleRematches(trip), []);
});

test("choosing a waiting Apple place again from a search puts it in hand; the open lookup's Apple hit is the same Apple place", () => {
  const opened = decodeTrip(encodeTrip({ ...emptyTrip, places: [applePlace(ITSUKUSHIMA, { day: 2 })] }))!;
  const chosen = putPlace(opened, applePlace(ITSUKUSHIMA));
  assert.deepEqual(chosen.places, [{ id: "apple-I7EA0EDCABFD8E819", name: "厳島神社", lat: 34.29577, lon: 132.32011, stayMinutes: 60, day: 2 }]);
  const hit = openCandidate({ id: "maps-I7EA0EDCABFD8E819", name: "厳島神社", latitude: 34.296, longitude: 132.3197, planningDurationMinutes: 60 }, null, 100);
  assert.equal(hit?.id, "apple-I7EA0EDCABFD8E819");
  // One with no Place ID could not be kept, so it is not offered.
  assert.equal(openCandidate({ id: "maps-34.29600,132.31970", name: "厳島神社", latitude: 34.296, longitude: 132.3197, planningDurationMinutes: 60 }, null, 100), null);
});

test("an Apple stop keeps a kind word only when the traveller's own action gave it", async () => {
  const { kindOfCategory } = await import("../lib/shiori/add-search.ts");
  // What a map category becomes is Apple's, whatever the words: not kept for a place added as a sight.
  for (const category of ["Restaurant", "Bakery", "Hotel", "Museum", "Park", "Store", "Nightlife", "Theater", "Zoo", "Aquarium", "AmusementPark", "Beach", "NationalPark", "Winery", "Brewery", "FoodMarket"]) {
    assert.equal(keptAppleKind(kindOfCategory(category)!, undefined), null, category);
  }
  // A restaurant chosen for a meal, and a café or bakery chosen for a break, keep the booklet's word.
  assert.equal(keptAppleKind("restaurant", "lunch"), "restaurant");
  assert.equal(keptAppleKind("cafe", undefined), "cafe");
  assert.equal(keptAppleKind("bakery cafe", undefined), "cafe");
  // A link from before this rule: the kind is dropped when read.
  const old = linkOf({ v: 1, c: null, n: "", d: 1, p: "standard", s: [["apple-IAAAABBBBCCCC0001", "", 0, 0, 60, null, "museum", null, null]], h: null });
  assert.equal(decodeTrip(old)?.places[0].kind, undefined);
  assert.ok(resavedForm(old));
});

test("while no Apple map can be shown, every place known from Apple is set aside, not removed, and the trip is not named after one", () => {
  const trip = tripWithApple();
  const legacy: ShioriPlace = { id: "apple-34.29577,132.32011", name: "旧い保存の場所", lat: 34.29577, lon: 132.32011, stayMinutes: 60 };
  const withLegacy = { ...trip, places: [...trip.places, legacy] };
  const shown = withoutAppleData(withLegacy);
  assert.deepEqual(shown.places.map((place) => place.id), ["wikidata-Q1", "hotpepper-J000123456", "osm-node-42"]);
  assert.equal(shown.hotel, null);
  assert.equal(appleDataCount(withLegacy), 4);
  // Nothing is taken out of the trip itself.
  assert.equal(withLegacy.places.length, 6);
  // A hotel kept without an id may be Apple's; one from the open lookup is not.
  assert.equal(withoutAppleData({ ...emptyTrip, hotel: { name: "古いホテル", lat: 34.39, lon: 132.46 } }).hotel, null);
  const osmHotel = { name: "駅前ホテル", lat: 34.3975, lon: 132.4753, id: "osm-node-7" };
  assert.deepEqual(withoutAppleData({ ...emptyTrip, hotel: osmHotel }).hotel, osmHotel);
  // A trip with none of Apple's places is the same trip.
  const plain = { ...emptyTrip, places: [trip.places[0]] };
  assert.equal(withoutAppleData(plain), plain);
  // The title (and the LINE text made from it) never takes an Apple place's name.
  assert.equal(tripTitleName({ ...trip, cityName: "" }), "原爆ドーム");
  assert.equal(tripTitleName({ ...trip, cityName: "", places: [trip.places[1]] }), "");
  assert.equal(tripTitleName(trip), "広島");
});

test("the page plans without Apple's places while the Apple map has failed, and says so in both languages", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  assert.match(page, /const usable = useMemo\(\(\) => \(appleMap === "failed" \? withoutAppleData\(plannableTrip\(trip\)\) : plannableTrip\(trip\)\)/);
  assert.match(page, /const cityTitle = tripTitleName\(trip\);/);
  assert.equal(page.match(/appleMapAside: \(count: number\) =>/g)?.length, 2);
});

test("a stop or hotel kept from before Place IDs that Apple's search does not find again is removed, and nothing else is", () => {
  const legacy: ShioriTrip = {
    ...emptyTrip,
    places: [{ id: "apple-34.29577,132.32011", name: "旧い保存の場所", lat: 34.29577, lon: 132.32011, stayMinutes: 60 }, { id: "wikidata-Q1", name: "原爆ドーム", lat: 34.39555, lon: 132.45358, stayMinutes: 30 }],
    hotel: { name: "古いホテル", lat: 34.39, lon: 132.46 },
  };
  assert.deepEqual(withoutRematch(legacy, "apple-34.29577,132.32011").places.map((place) => place.id), ["wikidata-Q1"]);
  assert.equal(withoutRematch(legacy, "hotel").hotel, null);
  // Only a legacy stop, and only an id-less hotel.
  assert.equal(withoutRematch(legacy, "wikidata-Q1"), legacy);
  const osmHotel = { ...legacy, hotel: { name: "駅前ホテル", lat: 34.3975, lon: 132.4753, id: "osm-node-7" } };
  assert.equal(withoutRematch(osmHotel, "hotel"), osmHotel);
});

test("the page removes a legacy stop only when Apple answered without it, and says how many in both languages", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  const effect = page.slice(page.indexOf("const rematches = useMemo"), page.indexOf("const usable = useMemo"));
  assert.match(effect, /if \(same\?\.id\) \{\s*setTrip\(\(current\) => withRematch\(current, stop\.key, same\.id!, same\)\);\s*\} else \{\s*setTrip\(\(current\) => withoutRematch\(current, stop\.key\)\);/);
  // A search that could not be asked removes nothing.
  assert.match(effect, /\}, \(\) => undefined\);/);
  assert.equal(page.match(/rematchGone: \(count: number\) =>/g)?.length, 2);
});

test("Apple's positions of places are not handed to another service: not to the shop guide, the forecast or the open search", async () => {
  const trip = tripWithApple();
  const points = applePositions(trip);
  // The two Apple places and the Apple hotel.
  assert.equal(points.length, 3);
  assert.equal(atApplePosition({ latitude: trip.places[1].lat, longitude: trip.places[1].lon }, points), true);
  assert.equal(atApplePosition({ latitude: trip.places[0].lat, longitude: trip.places[0].lon }, points), false);
  // The forecast's and the search's centre are made from the trip's other places only.
  assert.deepEqual(ownPlaces(trip.places).map((place) => place.id), ["wikidata-Q1", "hotpepper-J000123456", "osm-node-42"]);
  const { forecastCentre } = await import("../lib/shiori/forecast.ts");
  assert.equal(forecastCentre(null, ownPlaces([trip.places[1]])), null);
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  assert.match(page, /forecastCentre\(city, ownPlaces\(usable\.places\)\)/);
  assert.equal(page.match(/const anchor = addAnchor\(city, ownPlaces\(usable\.places\)\);/g)?.length, 2);
  assert.match(page, /if \(inJapan\(meal\.near\) && !appleNear\) \{/);
  assert.match(page, /inJapan\(cafe\.search\) && !appleNear \? fetchHotpepperShops/);
  assert.match(page, /advice=\{atApplePosition\(meal\.near, applePoints\) \? null : rowAdvice\(day\.index, meal\)\}/);
});
