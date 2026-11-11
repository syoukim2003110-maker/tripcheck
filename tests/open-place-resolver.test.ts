import assert from "node:assert/strict";
import test from "node:test";

import {
  foldPlaceName,
  leadingProperNoun,
  OpenPlaceResolver,
  placeNameSimilarity,
  placeTypesFromKinds,
} from "../lib/open-place-resolver.ts";
import type { PlaceResolutionRequest } from "../lib/google-place-resolver.ts";

/*
 * A tiny offline world. Each entry is one real-shaped sight; the fake fetcher
 * answers Wikipedia, Wikidata and the Wikidata query service from it exactly
 * the way the resolver asks, so these tests exercise the whole pipeline —
 * search, coordinates, region inference, decision — with no network.
 */
type Sight = {
  title: string;
  /** Other names Wikidata knows it by. */
  aliases?: string[];
  latitude: number;
  longitude: number;
  wikipedia?: { language: string; pageid: number; length?: number; noCoordinates?: boolean; disambiguation?: boolean };
  wikidata?: { id: string; sitelinks?: number; area?: string; kinds?: string[]; iso?: string };
};

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function parseSearch(value: string) {
  const near = value.match(/nearcoord:(\d+)km,(-?[\d.]+),(-?[\d.]+)/);
  const text = value.replace(/\s*haswbstatement:P625/, "").replace(/\s*nearcoord:\S+/, "").trim();
  return {
    text,
    near: near ? { radius: Number(near[1]), latitude: Number(near[2]), longitude: Number(near[3]) } : null,
  };
}

function world(sights: Sight[], options: { photon?: "down" | "empty"; wikimedia?: "down" } = {}) {
  const calls: URL[] = [];
  const matches = (sight: Sight, text: string) => [sight.title, ...(sight.aliases ?? [])]
    .some((name) => foldPlaceName(name).includes(foldPlaceName(text)));
  const within = (sight: Sight, near: ReturnType<typeof parseSearch>["near"]) => (
    !near || distanceKm(sight, near) <= near.radius
  );
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.host === "photon.komoot.io") {
      return options.photon === "empty"
        ? Response.json({ features: [] })
        : new Response("busy", { status: 503 });
    }
    if (url.host === "nominatim.openstreetmap.org") return Response.json([]);
    if (options.wikimedia === "down") return new Response("down", { status: 503 });

    if (url.host.endsWith(".wikipedia.org")) {
      const language = url.host.split(".")[0];
      if (url.searchParams.get("list") === "search") {
        const { text, near } = parseSearch(url.searchParams.get("srsearch") ?? "");
        return Response.json({ query: { search: sights
          .filter((sight) => sight.wikipedia?.language === language && matches(sight, text) && within(sight, near))
          .map((sight) => ({ pageid: sight.wikipedia!.pageid, title: sight.title })) } });
      }
      const ids = (url.searchParams.get("pageids") ?? "").split("|").map(Number);
      return Response.json({ query: { pages: sights
        .filter((sight) => sight.wikipedia?.language === language && ids.includes(sight.wikipedia.pageid))
        .map((sight) => ({
          pageid: sight.wikipedia!.pageid,
          title: sight.title,
          length: sight.wikipedia!.length ?? 20_000,
          ...(sight.wikipedia!.noCoordinates ? {} : {
            coordinates: [{ lat: sight.latitude, lon: sight.longitude, primary: true, globe: "earth" }],
          }),
          pageprops: {
            ...(sight.wikidata ? { wikibase_item: sight.wikidata.id } : {}),
            ...(sight.wikipedia!.disambiguation ? { disambiguation: "" } : {}),
          },
        })) } });
    }

    if (url.host === "www.wikidata.org") {
      const action = url.searchParams.get("action");
      if (action === "query") {
        const { text, near } = parseSearch(url.searchParams.get("gsrsearch") ?? "");
        return Response.json({ query: { pages: sights
          .filter((sight) => sight.wikidata && matches(sight, text) && within(sight, near))
          .map((sight, index) => ({
            title: sight.wikidata!.id,
            index: index + 1,
            coordinates: [{ lat: sight.latitude, lon: sight.longitude, globe: "earth" }],
          })) } });
      }
      if (action === "wbgetentities") {
        const ids = (url.searchParams.get("ids") ?? "").split("|");
        return Response.json({ entities: Object.fromEntries(sights
          .filter((sight) => sight.wikidata && ids.includes(sight.wikidata.id))
          .map((sight) => [sight.wikidata!.id, {
            labels: { ja: { value: sight.title } },
            aliases: { ja: (sight.aliases ?? []).map((value) => ({ value })) },
            descriptions: {},
            sitelinks: Object.fromEntries(Array.from({ length: sight.wikidata!.sitelinks ?? 20 }, (_, index) => [`wiki${index}`, {}])),
          }])) });
      }
      if (action === "wbgetclaims") {
        const sight = sights.find((entry) => entry.wikidata?.id === url.searchParams.get("entity"));
        return Response.json({ claims: sight ? { P625: [{ mainsnak: { datavalue: { value: {
          latitude: sight.latitude,
          longitude: sight.longitude,
          globe: "http://www.wikidata.org/entity/Q2",
        } } } }] } : {} });
      }
    }

    if (url.host === "query.wikidata.org") {
      const query = url.searchParams.get("query") ?? "";
      return Response.json({ results: { bindings: sights
        .filter((sight) => sight.wikidata && query.includes(`wd:${sight.wikidata.id} `))
        .flatMap((sight) => (sight.wikidata!.kinds ?? [""]).map((kind) => ({
          item: { value: `http://www.wikidata.org/entity/${sight.wikidata!.id}` },
          ...(sight.wikidata!.area ? { adminLabel: { value: sight.wikidata!.area } } : {}),
          ...(sight.wikidata!.iso ? { iso: { value: sight.wikidata!.iso } } : {}),
          ...(kind ? { kindName: { value: kind } } : {}),
        }))) } });
    }
    throw new Error(`unexpected host ${url.host}`);
  }) as typeof fetch;

  const resolver = new OpenPlaceResolver({ fetcher, hostIntervalMs: 0, sleep: async () => {} });
  return { resolver, calls };
}

function request(queries: string[], patch: Partial<PlaceResolutionRequest> = {}): PlaceResolutionRequest {
  return { queries, providerOverrides: [], hotelQuery: null, languageCode: "ja", destination: "auto", ...patch };
}

const hongKong: Sight[] = [
  { title: "ヴィクトリア・ピーク", latitude: 22.2755, longitude: 114.1438, wikipedia: { language: "ja", pageid: 1 }, wikidata: { id: "Q1", area: "中西区", kinds: ["mountain"] } },
  { title: "天壇大仏", latitude: 22.2541, longitude: 113.9051, wikipedia: { language: "ja", pageid: 2 }, wikidata: { id: "Q2", area: "離島区", kinds: ["statue"] } },
  { title: "香港ディズニーランド", latitude: 22.3133, longitude: 114.0433, wikipedia: { language: "ja", pageid: 3 }, wikidata: { id: "Q3", kinds: ["amusement park"] } },
  // The Japanese headword is a disambiguation page; the real temple only has
  // a Wikidata item, written with the traditional character.
  { title: "黄大仙祠", latitude: 0, longitude: 0, wikipedia: { language: "ja", pageid: 4, disambiguation: true } },
  { title: "黃大仙祠", aliases: ["嗇色園黃大仙祠"], latitude: 22.3425, longitude: 114.1935, wikidata: { id: "Q5", sitelinks: 15, area: "黄大仙区", kinds: ["temple"] } },
  { title: "黄大仙祠 (広州市)", latitude: 23.0961, longitude: 113.2257, wikipedia: { language: "ja", pageid: 6, length: 3_000 }, wikidata: { id: "Q6", sitelinks: 3 } },
  { title: "スター・フェリー・ピア", aliases: ["スターフェリー"], latitude: 22.2938, longitude: 114.1687, wikidata: { id: "Q7", kinds: ["ferry pier"] } },
];

test("a Hong Kong wishlist in Japanese resolves without a single traveller choice", async () => {
  const { resolver, calls } = world(hongKong);
  const result = await resolver.resolve(request(["ビクトリアピーク", "天壇大仏", "香港ディズニーランド", "黄大仙祠", "スターフェリー"]));

  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.places.map((place) => place.input), ["ビクトリアピーク", "天壇大仏", "香港ディズニーランド", "黄大仙祠", "スターフェリー"]);
  const byInput = new Map(result.places.map((place) => [place.input, place]));
  // The ヴ-row and the long-vowel mark are spelling, not a different place.
  assert.equal(byInput.get("ビクトリアピーク")?.name, "ヴィクトリア・ピーク");
  // The wishlist said Hong Kong; the Guangzhou namesake 130 km away loses.
  assert.ok(Math.abs(byInput.get("黄大仙祠")!.latitude - 22.3425) < 0.001);
  assert.equal(byInput.get("黄大仙祠")?.area, "黄大仙区");
  assert.equal(byInput.get("ビクトリアピーク")?.countryCode, "HK");
  // Nothing may depend on the throttled public Photon instance: once it has
  // refused, it is not asked again — only the lookups already in flight
  // (one per concurrent input) ever reach it, not one per line and per pass.
  assert.ok(calls.filter((url) => url.host === "photon.komoot.io").length <= 4);
});

test("the kind of place sets a believable stay instead of a flat ninety minutes", async () => {
  const { resolver } = world(hongKong);
  const result = await resolver.resolve(request(["ビクトリアピーク", "天壇大仏", "香港ディズニーランド", "黄大仙祠", "スターフェリー"]));
  const stay = new Map(result.places.map((place) => [place.input, place.planningDurationMinutes]));
  assert.equal(stay.get("スターフェリー"), 45);
  assert.equal(stay.get("黄大仙祠"), 60);
  assert.equal(stay.get("香港ディズニーランド"), 540);
});

test("a namesake with no trip around it goes back to the traveller", async () => {
  const { resolver } = world([
    { title: "清水寺", latitude: 34.9948, longitude: 135.785, wikipedia: { language: "ja", pageid: 10, length: 20_000 }, wikidata: { id: "Q10", sitelinks: 20 } },
    { title: "清水寺 (加東市)", latitude: 34.972, longitude: 135.082, wikipedia: { language: "ja", pageid: 11, length: 20_000 }, wikidata: { id: "Q11", sitelinks: 20 } },
  ]);
  const result = await resolver.resolve(request(["清水寺"]));
  assert.deepEqual(result.places, []);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].candidates.length, 2);
});

test("the rest of the wishlist settles the same namesake", async () => {
  const { resolver } = world([
    { title: "清水寺", latitude: 34.9948, longitude: 135.785, wikipedia: { language: "ja", pageid: 10 }, wikidata: { id: "Q10" } },
    { title: "清水寺 (加東市)", latitude: 34.972, longitude: 135.082, wikipedia: { language: "ja", pageid: 11 }, wikidata: { id: "Q11" } },
    { title: "伏見稲荷大社", latitude: 34.9669, longitude: 135.7731, wikipedia: { language: "ja", pageid: 12 }, wikidata: { id: "Q12" } },
    { title: "二条城", latitude: 35.0142, longitude: 135.7475, wikipedia: { language: "ja", pageid: 13 }, wikidata: { id: "Q13" } },
  ]);
  const result = await resolver.resolve(request(["清水寺", "伏見稲荷大社", "二条城"]));
  assert.deepEqual(result.ambiguous, []);
  assert.ok(Math.abs(result.places.find((place) => place.input === "清水寺")!.longitude - 135.785) < 0.001);
});

test("an alias finds the place and keeps the name the traveller typed: 金閣寺 is 鹿苑寺", async () => {
  const { resolver } = world([
    { title: "鹿苑寺", aliases: ["金閣寺"], latitude: 35.0395, longitude: 135.7285, wikidata: { id: "Q20", sitelinks: 80 } },
    { title: "二条城", latitude: 35.0142, longitude: 135.7475, wikipedia: { language: "ja", pageid: 21 }, wikidata: { id: "Q21" } },
    { title: "錦市場", latitude: 35.005, longitude: 135.765, wikipedia: { language: "ja", pageid: 22 }, wikidata: { id: "Q22" } },
  ]);
  const result = await resolver.resolve(request(["金閣寺", "二条城", "錦市場"]));
  const kinkakuji = result.places.find((place) => place.input === "金閣寺");
  assert.equal(kinkakuji?.name, "金閣寺");
  assert.equal(kinkakuji?.id, "wikidata-Q20");
  assert.ok(Math.abs(kinkakuji!.latitude - 35.0395) < 0.001);
});

test("a name nothing knows stays unresolved instead of becoming a guess", async () => {
  const { resolver } = world(hongKong);
  const result = await resolver.resolve(request(["ビクトリアピーク", "天壇大仏", "だれも知らない店"]));
  assert.equal(result.places.length, 2);
  assert.equal(result.places.some((place) => place.input === "だれも知らない店"), false);
  assert.deepEqual(result.ambiguous, []);
});

test("every source being down is an error, not an empty answer", async () => {
  const { resolver } = world(hongKong, { wikimedia: "down" });
  await assert.rejects(() => resolver.resolve(request(["ビクトリアピーク"])), /open_place_sources_unavailable/);
});

test("an explicit destination boundary still rejects answers outside it", async () => {
  const { resolver } = world([
    { title: "黄大仙祠 (広州市)", latitude: 23.0961, longitude: 113.2257, wikipedia: { language: "ja", pageid: 6 }, wikidata: { id: "Q6" } },
  ]);
  const result = await resolver.resolve(request(["黄大仙祠"], { destination: "hongkong" }));
  assert.deepEqual(result.places, []);
  assert.deepEqual(result.ambiguous, []);
});

test("spelling folds: width, the ヴ-row, long vowels, disambiguators and Han variants", () => {
  assert.equal(foldPlaceName("ヴィクトリア・ピーク"), foldPlaceName("ビクトリアピーク"));
  assert.equal(foldPlaceName("黃大仙祠"), foldPlaceName("黄大仙祠"));
  assert.equal(foldPlaceName("天坛大佛"), foldPlaceName("天壇大仏"));
  assert.equal(foldPlaceName("黄大仙祠 (香港)"), foldPlaceName("黄大仙祠"));
  assert.equal(placeNameSimilarity("女人街", "女人街 Ladies Market"), 1);
  assert.equal(placeNameSimilarity("Ladies Market", "女人街 Ladies Market"), 1);
  assert.ok(placeNameSimilarity("新宿御苑", "新宿") < 0.8);
  assert.ok(placeNameSimilarity("エッフェル塔", "塔") < 0.5);
});

test("only a Han proper noun with a descriptive tail is split", () => {
  assert.equal(leadingProperNoun("尖沙咀プロムナード"), "尖沙咀");
  assert.equal(leadingProperNoun("新宿御苑"), null);
  assert.equal(leadingProperNoun("ビクトリアピーク"), null);
  assert.equal(leadingProperNoun("Shibuya crossing"), null);
});

test("Wikidata kinds map onto the stay table's place types", () => {
  assert.deepEqual(placeTypesFromKinds(["buddhist temple", "tourist attraction"]), ["buddhist_temple"]);
  assert.deepEqual(placeTypesFromKinds(["ferry pier"]), ["pier"]);
  assert.deepEqual(placeTypesFromKinds(["amusement park", "theme park"]), ["amusement_park"]);
  assert.deepEqual(placeTypesFromKinds(["mountain"]), []);
});
