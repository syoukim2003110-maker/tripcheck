/*
 * What a traveller reads on a train leg — board at this station, this line,
 * get off there — comes straight from the bundled networks in public/rail.
 * These tests hold every one of them to the rules the booklet depends on, and
 * pin a handful of journeys anyone can check against a real map.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { RailNetwork, plainEnglishStationName, plainStationName, type RailJourney, type RailNetworkData } from "../lib/rail-router.ts";

const directory = new URL("../public/rail/", import.meta.url);
const networks = new Map<string, RailNetworkData>(
  readdirSync(directory).filter((file) => file.endsWith(".json")).sort()
    .map((file) => [file.replace(".json", ""), JSON.parse(readFileSync(new URL(file, directory), "utf8")) as RailNetworkData]),
);
const network = (id: string) => {
  const data = networks.get(id);
  assert.ok(data, `no bundled network for ${id}`);
  return data;
};

/*
 * Links whose line Wikidata does not give: no line or service on the link,
 * and the two stations share no line (or too many to tell). The page writes
 * "train" for them rather than a made-up name. The numbers are ceilings — a
 * regenerated network may have fewer, never more without someone looking.
 */
const linksWithoutLine: Record<string, { atMost: number; why: string }> = {
  prague: { atMost: 216, why: "the tram stops carry no line or service at all in Wikidata; the metro is named" },
  london: { atMost: 31, why: "National Rail links around Blackfriars, Lewisham and Kensal Green have no line recorded" },
  berlin: { atMost: 13, why: "mostly the Wuhlheide park railway, which has no line item" },
  bangkok: { atMost: 11, why: "State Railway halts with no line recorded" },
  sanfrancisco: { atMost: 10, why: "ferry terminals and Market Street stops with no service recorded" },
  beijing: { atMost: 8, why: "the line is recorded as 'unknown value'" },
  barcelona: { atMost: 7, why: "FGC and funicular links with no line recorded" },
  budapest: { atMost: 7, why: "tram links with no line recorded" },
  losangeles: { atMost: 6, why: "links with no line recorded" },
  shanghai: { atMost: 5, why: "the line is recorded as 'unknown value'" },
  hanoi: { atMost: 4, why: "Vietnam Railways links with no line recorded" },
  nagoya: { atMost: 4, why: "guided-bus stops with no line recorded" },
  florence: { atMost: 3, why: "links with no line recorded" },
  hakodate: { atMost: 3, why: "three tram links whose stops share no route in Wikidata" },
  hongkong: { atMost: 3, why: "links with no line recorded" },
  kualalumpur: { atMost: 3, why: "links with no line recorded" },
  seoul: { atMost: 3, why: "links with no line recorded" },
  vienna: { atMost: 3, why: "links with no line recorded" },
  amsterdam: { atMost: 2, why: "links with no line recorded" },
  lisbon: { atMost: 2, why: "the 25 de Abril bridge railway has no line recorded" },
  manila: { atMost: 2, why: "links with no line recorded" },
  yokohama: { atMost: 2, why: "freight-line links (鶴見–新川崎, 桜木町–東高島) with no passenger line" },
  milan: { atMost: 1, why: "one link with no line recorded" },
  osaka: { atMost: 1, why: "one link with no line recorded" },
  paris: { atMost: 1, why: "one link with no line recorded" },
  rome: { atMost: 1, why: "one link with no line recorded" },
  singapore: { atMost: 1, why: "one link with no line recorded" },
  sydney: { atMost: 1, why: "one link with no line recorded" },
  taipei: { atMost: 1, why: "one link with no line recorded" },
  tokyo: { atMost: 1, why: "the freight-line link 鶴見–新川崎 has no passenger line" },
  venice: { atMost: 1, why: "one link with no line recorded" },
};

/*
 * Official station names that begin with what looks like a line or a kind
 * of railway. Checked against the operator's own naming.
 */
const realNamesThatLookGlued = new Set([
  // Uijeongbu LRT: the station really is 경전철의정부 ("Light-rail Uijeongbu").
  "軽電鉄議政府駅",
  // Sydney Airport Link: "Domestic Airport".
  "国内線空港駅",
]);

test("every bundled network is well formed and every station has a name in both languages", () => {
  assert.ok(networks.size >= 59, `expected the 59 bundled networks, found ${networks.size}`);
  for (const [id, data] of networks) {
    assert.equal(data.id, id);
    for (const [ja, en, latitude, longitude] of data.stations) {
      assert.ok(ja.trim().length >= 1 && en.trim().length >= 1, `${id}: a station has an empty name (${ja} / ${en})`);
      assert.ok(!/^Q\d+$/.test(ja) && !/^Q\d+$/.test(en), `${id}: a station is named by its Wikidata id (${ja})`);
      assert.ok(Number.isFinite(latitude) && Number.isFinite(longitude), `${id}: ${ja} has no position`);
    }
    for (const [from, to, line] of data.edges) {
      assert.ok(data.stations[from] && data.stations[to] && from !== to, `${id}: a link points at a missing station`);
      assert.ok(line === -1 || data.lines[line], `${id}: a link points at a missing line`);
    }
  }
});

test("a ride always has a line to board: no named line is blank, and unnamed links are counted and explained", () => {
  for (const [id, data] of networks) {
    for (const [ja, en] of data.lines) {
      assert.ok(ja.trim() && en.trim(), `${id}: a line has an empty name (${ja} / ${en})`);
      // The placeholders an earlier generator wrote in place of a missing name.
      assert.ok(ja !== "電車" && en !== "Rail", `${id}: a line carries a made-up name`);
    }
    const used = new Set(data.edges.map((edge) => edge[2]));
    data.lines.forEach((line, index) => assert.ok(used.has(index), `${id}: line ${line[0]} has no link — a name without trains`));
    const unnamed = data.edges.filter((edge) => edge[2] < 0).length;
    const allowed = linksWithoutLine[id]?.atMost ?? 0;
    assert.ok(unnamed <= allowed, `${id}: ${unnamed} links have no line, ${allowed} are accounted for (${linksWithoutLine[id]?.why ?? "none expected"})`);
  }
  for (const [id, entry] of Object.entries(linksWithoutLine)) assert.ok(networks.has(id) && entry.why.length > 10, `${id}: stale or unexplained allowance`);
});

test("no station name has a company or a line glued to the front, or an encyclopedia's bracket on the end", () => {
  for (const [id, data] of networks) {
    const lineNames = data.lines.map((line) => line[0]).filter((name) => name.length >= 3 && /(線|ライン|ライナー)$/.test(name));
    for (const [ja, en] of data.stations) {
      // Already plain: running the cleaner again changes nothing.
      assert.equal(plainStationName(ja), ja, `${id}: ${ja} still carries a company prefix or a bracket`);
      assert.equal(plainStationName(en), en, `${id}: ${en} still carries a company prefix or a bracket`);
      if (!ja.endsWith("駅") || realNamesThatLookGlued.has(ja)) continue;
      assert.ok(!lineNames.some((line) => ja.startsWith(line)), `${id}: ${ja} starts with a line name`);
      assert.ok(!/^[^・]*[一-鿿]線.+駅$/.test(ja), `${id}: ${ja} looks like "…線…駅"`);
      assert.ok(!/駅駅$/.test(ja), `${id}: ${ja} says 駅 twice`);
    }
  }
});

test("places a passenger cannot board, and trains nobody takes across a city, are not on the map", () => {
  for (const [id, data] of networks) {
    for (const [ja, en] of data.stations) {
      assert.ok(!/信号場|信号所|貨物駅|貨物ターミナル|操車場|車両基地/.test(ja), `${id}: ${ja} is not a passenger station`);
      assert.ok(!/Signal (Base|Station|Box)\b|Freight (Terminal|Station)/i.test(en), `${id}: ${en} is not a passenger station`);
    }
    for (const [ja, en] of data.lines) assert.ok(!/新幹線|Shinkansen|\bKTX\b|high[- ]speed/i.test(`${ja} ${en}`), `${id}: ${ja} is a high-speed line`);
  }
});

const named = (data: RailNetworkData, pattern: RegExp) => data.stations.filter(([ja, en]) => pattern.test(ja) || pattern.test(en)).map(([ja, en]) => `${ja} / ${en}`);

test("Tokyo: 市ケ谷 is 市ケ谷 on every line, and とうきょうスカイツリー keeps its official hiragana name", () => {
  const tokyo = network("tokyo");
  // Was: 東京メトロ有楽町線市ケ谷駅, 東京メトロ南北線市ケ谷駅, JR東日本市ケ谷駅 and
  // 都営地下鉄市ヶ谷駅 — four items for one station. Toei writes it with a small ヶ.
  assert.deepEqual(named(tokyo, /市[ケヶ]谷/).sort(), ["市ケ谷駅 / Ichigaya Station", "市ケ谷駅 / Ichigaya Station", "市ケ谷駅 / Ichigaya Station", "市ヶ谷駅 / Ichigaya Station"]);
  // Tōbu named the station in hiragana in 2012; that is not a reading aid to "fix".
  assert.deepEqual(named(tokyo, /スカイツリー/), ["とうきょうスカイツリー駅 / Tokyo Skytree Station"]);
  for (const plain of ["渋谷駅", "新宿駅", "上野駅", "東京駅", "品川駅", "池袋駅", "練馬駅"]) assert.ok(tokyo.stations.some(([ja]) => ja === plain), `${plain} is missing`);
  assert.deepEqual(named(tokyo, /^(JR東日本|東京メトロ|都営|東急電鉄|京王電鉄|小田急電鉄|西武鉄道|東武鉄道|新線|JR East|Tokyo Metro|Toei Subway)/), []);
});

test("Osaka, Seoul and Paris: the name on the sign, in the language asked for", () => {
  const osaka = network("osaka");
  // Was: 大阪メトロ梅田駅, 大阪メトロ新大阪駅 / "Osaka Metro Shin-Osaka Station".
  assert.ok(named(osaka, /^梅田駅$/).includes("梅田駅 / Umeda Station"));
  assert.deepEqual(named(osaka, /^新大阪駅$/).sort(), ["新大阪駅 / Shin-Osaka Station", "新大阪駅 / Shin-Ōsaka Station"]);
  assert.deepEqual(named(osaka, /大阪メトロ|Osaka Metro|JR West|\((Hanshin|Hankyu)\)/), []);
  // "JR難波" is the real name of that station and must survive.
  assert.ok(named(osaka, /^JR難波駅$/).includes("JR難波駅 / JR Namba Station"));
  // A station with no Japanese label borrows it from its twin next door (was "Nakamozu").
  assert.ok(!osaka.stations.some(([ja]) => ja === "Nakamozu") && osaka.stations.some(([ja, en]) => ja === "中百舌鳥駅" && en === "Nakamozu"));

  const seoul = network("seoul");
  // Was: ソウル駅駅 (the metro's item) and 龍山駅（首都圏電鉄）.
  assert.deepEqual(named(seoul, /^ソウル駅/), ["ソウル駅 / Seoul Station", "ソウル駅 / Seoul Station"]);
  assert.ok(named(seoul, /^龍山駅$/).length >= 2);
  assert.deepEqual(named(seoul, /駅駅|首都圏電鉄）/), []);
  assert.ok(named(seoul, /^江南駅$/).includes("江南駅 / Gangnam Station"));

  const paris = network("paris");
  // Was: "Laplace (Paris - RER)", "Bondy (Paris RER)", "… (tramway d'Île-de-France)".
  assert.deepEqual(named(paris, /^Laplace/), ["Laplace / Laplace"]);
  assert.deepEqual(named(paris, /\((Paris|tramway)/i), []);
  assert.ok(named(paris, /ルーヴル/).includes("パレ・ロワイヤル＝ミュゼ・デュ・ルーヴル駅 / Palais Royal - Musée du Louvre"));
});

test("the name cleaner removes companies and lines, and leaves real names alone", () => {
  assert.equal(plainStationName("東京メトロ有楽町線市ケ谷駅", ["東京メトロ有楽町線"]), "市ケ谷駅");
  assert.equal(plainStationName("京王電鉄 京王線新宿駅", ["京王線"]), "新宿駅");
  assert.equal(plainStationName("東急電鉄・東京メトロ・都営地下鉄目黒駅"), "目黒駅");
  assert.equal(plainStationName("新幹線名古屋駅"), "名古屋駅");
  assert.equal(plainStationName("代々木駅 (都営地下鉄)"), "代々木駅");
  assert.equal(plainStationName("龍山駅（首都圏電鉄）"), "龍山駅");
  assert.equal(plainStationName("ソウル駅駅"), "ソウル駅");
  assert.equal(plainStationName("Laplace (Paris - RER)"), "Laplace");
  assert.equal(plainStationName("Tram stop Rijksmuseum"), "Rijksmuseum");
  assert.equal(plainStationName("Tokyo Metro Ueno Station"), "Ueno Station");
  assert.equal(plainStationName("Osaka-Umeda Station (Hanshin)"), "Osaka-Umeda Station");
  assert.equal(plainEnglishStationName("Tokyu Railways, Tokyo Metro and Toei Subway Meguro Station"), "Meguro Station");
  assert.equal(plainEnglishStationName("Keiō Line Shinjuku Station", ["Keiō Line"]), "Shinjuku Station");
  // Real names that only look like a prefix or a disambiguation.
  for (const real of ["とうきょうスカイツリー駅", "京成上野駅", "西武新宿駅", "近鉄奈良駅", "JR難波駅", "京急蒲田駅", "地下鉄成増駅", "モノレール浜松町駅", "西鉄福岡（天神）駅", "総神大入口（梨水）駅", "東京駅", "線駅"]) {
    assert.equal(plainStationName(real), real);
  }
  // A suburb in brackets is the tram operator's own way of naming the stop.
  assert.equal(plainStationName("Albion St/Melville Rd (Brunswick West)"), "Albion St/Melville Rd (Brunswick West)");
  assert.equal(plainStationName("JR Namba Station"), "JR Namba Station");
  assert.equal(plainStationName("Toeizan Station"), "Toeizan Station");
});

const describe = (journey: RailJourney | null) => journey
  ? `${journey.walkToStation} | ${journey.rides.map((ride) => `${ride.from} →(${ride.line ?? "?"}, ${ride.stops})→ ${ride.to}`).join(" ⇄ ")} | ${journey.totalMinutes}`
  : "no train";
const routers = new Map<string, RailNetwork>();
function journey(city: string, from: [number, number], to: [number, number], language: "ja" | "en" = "ja") {
  if (!routers.has(city)) routers.set(city, new RailNetwork(network(city)));
  return describe(routers.get(city)!.route({ latitude: from[0], longitude: from[1] }, { latitude: to[0], longitude: to[1] }, language));
}

/*
 * Journeys anyone can check on a map. "Before" is what the same router said
 * with the networks as they were bundled on 2026-11-11.
 */
test("well-known journeys read the way the signs do", () => {
  const asakusa: [number, number] = [35.7107, 139.7976];
  const shibuya: [number, number] = [35.6590, 139.7016];
  // Before (ja): identical. Before (en): "… → Tokyu Railways and Tokyo Metro Shibuya Station".
  assert.equal(journey("tokyo", asakusa, shibuya), "浅草駅 | 浅草駅 →(東京メトロ銀座線, 18)→ 渋谷駅 | 46");
  assert.equal(journey("tokyo", asakusa, shibuya, "en"), "Asakusa Station | Asakusa Station →(Ginza Line, 18)→ Shibuya Station | 46");

  const umeda: [number, number] = [34.7036, 135.4975];
  const namba: [number, number] = [34.6661, 135.5010];
  // Before: identical in both languages.
  assert.equal(journey("osaka", umeda, namba), "梅田駅 | 梅田駅 →(御堂筋線, 4)→ 難波駅 | 17");
  assert.equal(journey("osaka", umeda, namba, "en"), "Umeda Station | Umeda Station →(Midōsuji Line, 4)→ Namba Station | 17");

  // Before: 新宿駅 →(中央本線, 4)→ 東京駅 — the track's name; the platform says 中央線快速.
  // Before (en): "JR East Shinjuku Station →(Chūō Main Line, 4)→ JR East Tokyo Station".
  assert.equal(journey("tokyo", [35.6905, 139.7005], [35.6812, 139.7671]), "新宿駅 | 新宿駅 →(中央線快速, 4)→ 東京駅 | 23");
  assert.equal(journey("tokyo", [35.6905, 139.7005], [35.6812, 139.7671], "en"), "Shinjuku Station | Shinjuku Station →(Chūō Line (Rapid), 4)→ Tokyo Station | 23");

  // Before: 南北線市ケ谷駅 →(東京メトロ南北線, 5)→ 麻布十番駅 ⇄ … — a line name glued to the station.
  assert.equal(journey("tokyo", [35.6919, 139.7357], [35.6628, 139.7314]), "市ケ谷駅 | 市ケ谷駅 →(東京メトロ南北線, 5)→ 麻布十番駅 ⇄ 麻布十番駅 →(都営地下鉄大江戸線, 1)→ 六本木駅 | 27");

  // Before: identical. The hiragana name is the official one.
  assert.equal(journey("tokyo", [35.7101, 139.8107], [35.7138, 139.7773]), "とうきょうスカイツリー駅 | とうきょうスカイツリー駅 →(東武伊勢崎線, 1)→ 浅草駅 ⇄ 浅草駅 →(東京メトロ銀座線, 3)→ 上野駅 | 26");

  // Before (en): "Osaka Metro Shin-Osaka Station →(Midōsuji Line, 10)→ Tennōji Station".
  assert.equal(journey("osaka", [34.7335, 135.5003], [34.6466, 135.5136], "en"), "Shin-Osaka Station | Shin-Osaka Station →(Midōsuji Line, 10)→ Tennōji Station | 36");

  // Before (en): "Kyoto Municipal Subway Kyōto Station →(Karasuma Line, 2)→ Shijō Station".
  assert.equal(journey("kyoto", [34.9858, 135.7588], [35.0036, 135.7595], "en"), "Kyōto Station | Kyōto Station →(Karasuma Line, 2)→ Shijō Station | 13");

  // Before: ソウル駅 →(京釜線, 1)→ 龍山駅 ⇄ 龍山駅 →(?, 2)→ 銅雀駅 ⇄ … (46 min): a ride with no line to board.
  assert.equal(journey("seoul", [37.5547, 126.9707], [37.4979, 127.0276]), "ソウル駅 | ソウル駅 →(首都圏電鉄4号線, 5)→ 銅雀駅 ⇄ 銅雀駅 →(ソウル市メトロ9号線急行, 2)→ 新論峴駅 ⇄ 新論峴駅 →(新盆唐線, 1)→ 江南駅 | 44");

  // Before: identical.
  assert.equal(journey("paris", [48.8606, 2.3376], [48.8738, 2.2950]), "パレ・ロワイヤル＝ミュゼ・デュ・ルーヴル駅 | パレ・ロワイヤル＝ミュゼ・デュ・ルーヴル駅 →(パリメトロ1号線, 5)→ ジョルジュ・サンク駅 | 25");
  assert.equal(journey("london", [51.5308, -0.1238], [51.5010, -0.1247], "en"), "King's Cross St Pancras tube station | King's Cross St Pancras tube station →(Victoria line, 4)→ Green Park tube station ⇄ Green Park tube station →(Jubilee line, 1)→ Westminster tube station | 23");
});

test("a line the data has but cannot name is reported as unnamed, not as a blank", () => {
  const toy: RailNetworkData = {
    id: "toy",
    stations: [["西駅", "West", 35, 139], ["中駅", "Central", 35, 139.02], ["東駅", "East", 35, 139.04]],
    lines: [["", ""]],
    edges: [[0, 1, 0], [1, 2, 0]],
  };
  const ride = new RailNetwork(toy).route({ latitude: 35, longitude: 139 }, { latitude: 35, longitude: 139.04 })?.rides[0];
  assert.ok(ride);
  // One ride, not two: staying on the unnamed line is not a change of train.
  assert.deepEqual([ride.line, ride.from, ride.to, ride.stops], [null, "西駅", "東駅", 2]);
});
