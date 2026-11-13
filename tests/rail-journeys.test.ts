/*
 * Journeys a traveller actually makes, driven through the real router over
 * the bundled networks. Each one was found wrong by an audit of the maps
 * regenerated on 2026-11-12 — a change of train that does not exist, a
 * freight line offered as a ride, a tram named after a route that hardly
 * runs — and is pinned here to what happens on the ground.
 *
 * "Was" is what the same journey read before the fix. Stations are looked up
 * by the name on the sign; where two stations share a name (JR and subway)
 * the test says which by a line it must be on.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { RailNetwork, type RailJourney, type RailNetworkData } from "../lib/rail-router.ts";

const directory = new URL("../public/rail/", import.meta.url);
const networks = new Map<string, RailNetworkData>(
  readdirSync(directory).filter((file) => file.endsWith(".json")).sort()
    .map((file) => [file.replace(".json", ""), JSON.parse(readFileSync(new URL(file, directory), "utf8")) as RailNetworkData]),
);
const routers = new Map<string, RailNetwork>();
const router = (city: string) => {
  if (!routers.has(city)) routers.set(city, new RailNetwork(networks.get(city)!));
  return routers.get(city)!;
};

type Place = string | [number, number];
/** A point, or the station with this name — the one on `line` when several share the name. */
function point(city: string, place: Place, line?: string) {
  if (typeof place !== "string") return { latitude: place[0], longitude: place[1] };
  const data = networks.get(city)!;
  const candidates = data.stations.map((station, index) => ({ station, index })).filter(({ station }) => station[0] === place || station[1] === place);
  const lineIndex = line ? data.lines.findIndex(([ja]) => ja === line) : -1;
  const hit = line ? candidates.find(({ index }) => data.edges.some((edge) => edge[2] === lineIndex && (edge[0] === index || edge[1] === index))) : candidates[0];
  assert.ok(hit, `${city}: no station ${place}${line ? ` on ${line}` : ""}`);
  return { latitude: hit.station[2], longitude: hit.station[3] };
}
function journey(city: string, from: Place, to: Place, options: { language?: "ja" | "en"; fromLine?: string; toLine?: string } = {}) {
  return router(city).route(point(city, from, options.fromLine), point(city, to, options.toLine), options.language ?? "ja");
}
/** "横浜駅 →(京浜東北線・根岸線, 3)→ 石川町駅 ⇄ …" */
const rides = (found: RailJourney | null) => (found ? found.rides.map((ride) => `${ride.from} →(${ride.line ?? "?"}, ${ride.stops})→ ${ride.to}`).join(" ⇄ ") : "no train");
const lines = (found: RailJourney | null) => (found ? found.rides.map((ride) => ride.line ?? "?") : []);
function oneRide(city: string, from: Place, to: Place, line: string, options: { language?: "ja" | "en"; fromLine?: string; toLine?: string } = {}) {
  const found = journey(city, from, to, options);
  assert.deepEqual(lines(found), [line], `${city} ${String(from)} → ${String(to)}: ${rides(found)}`);
  return found!;
}

// ---------------------------------------------------------------------------
// One train is one ride: no change where the name of the line changes
// ---------------------------------------------------------------------------

test("Kyoto: the 嵯峨野線 to Saga-Arashiyama and beyond is one ride, in both directions", () => {
  // Was: 京都駅 →(嵯峨野線, 6)→ 太秦駅 ⇄ 太秦駅 →(山陰本線, 1)→ 嵯峨嵐山駅, 33 min.
  const kyoto: [number, number] = [34.9858, 135.7588];
  const sagaArashiyama: [number, number] = [35.0186, 135.6811];
  assert.equal(rides(journey("kyoto", kyoto, sagaArashiyama)), "京都駅 →(嵯峨野線, 7)→ 嵯峨嵐山駅");
  assert.equal(journey("kyoto", kyoto, sagaArashiyama)!.totalMinutes, 27);
  // Was: a change at 花園 on the way back.
  assert.equal(rides(journey("kyoto", sagaArashiyama, kyoto)), "嵯峨嵐山駅 →(嵯峨野線, 7)→ 京都駅");
  // Was: 嵯峨野線 to 太秦, a walk to 帷子ノ辻 and the 嵐電, 44 min. 渡月橋 is a walk from 嵯峨嵐山.
  assert.equal(rides(journey("kyoto", kyoto, [35.0129, 135.6777])), "京都駅 →(嵯峨野線, 7)→ 嵯峨嵐山駅");
  // Was: three rides (嵯峨野線 → 山陰本線 → 嵯峨野観光線).
  assert.deepEqual(lines(journey("kyoto", kyoto, [35.0170, 135.6713])), ["嵯峨野線", "嵯峨野観光線"]);
  oneRide("kyoto", "二条駅", "嵯峨嵐山駅", "嵯峨野線");
  oneRide("kyoto", "京都駅", "亀岡駅", "嵯峨野線", { fromLine: "嵯峨野線" });
  // No 山陰本線 is left to change onto.
  assert.ok(!networks.get("kyoto")!.lines.some(([ja]) => ja === "山陰本線"));
});

test("Kyoto: the 琵琶湖線 to Ōtsu, Zeze and Ishiyama is one ride, and runs through Kyōto onto the JR京都線", () => {
  // Was: 京都駅 →(琵琶湖線, 2)→ 大津駅 ⇄ 大津駅 →(東海道本線, 2)→ 石山駅, 39 min.
  assert.equal(rides(journey("kyoto", "京都駅", "石山駅", { fromLine: "琵琶湖線" })), "京都駅 →(琵琶湖線, 4)→ 石山駅");
  assert.equal(journey("kyoto", "京都駅", "石山駅", { fromLine: "琵琶湖線" })!.totalMinutes, 33);
  oneRide("kyoto", "京都駅", "膳所駅", "琵琶湖線", { fromLine: "琵琶湖線" });
  // Was: 琵琶湖線 → 東海道本線 → 石山坂本線 → 石山坂本線, 69 min.
  assert.deepEqual(lines(journey("kyoto", [34.9857, 135.7586], [34.9606, 135.9056])).slice(0, 2), ["琵琶湖線", "石山坂本線"]);
  oneRide("kyoto", "京都駅", "長岡京駅", "JR京都線", { fromLine: "JR京都線" });
  // The same train on both sides of 京都: one ride, named as the announcements name it.
  assert.equal(rides(journey("kyoto", "山科駅", "西大路駅", { fromLine: "琵琶湖線" })), "山科駅 →(琵琶湖線・JR京都線, 2)→ 西大路駅");
  assert.equal(rides(journey("kyoto", "山科駅", "西大路駅", { fromLine: "琵琶湖線", language: "en" })), "Yamashina Station →(Biwako Line / JR Kyoto Line, 2)→ Nishiōji Station");
});

test("Kyoto: Keihan trains run through 三条, and the 鞍馬 train starts at 出町柳", () => {
  // Was: 出町柳駅 →(京阪鴨東線, 2)→ 三条駅 ⇄ 三条駅 →(京阪本線, 1)→ 祇園四条駅, 17 min.
  assert.equal(rides(journey("kyoto", "出町柳駅", "祇園四条駅", { fromLine: "京阪鴨東線" })), "出町柳駅 →(京阪鴨東線・京阪本線, 3)→ 祇園四条駅");
  oneRide("kyoto", "出町柳駅", "伏見稲荷駅", "京阪鴨東線・京阪本線", { fromLine: "京阪鴨東線" });
  // Was: 叡山本線 to 宝ヶ池, change, 鞍馬線.
  assert.equal(rides(journey("kyoto", "出町柳駅", "鞍馬駅", { fromLine: "叡山本線" })), "出町柳駅 →(鞍馬線, 14)→ 鞍馬駅");
  // The other branch is still a change at 宝ヶ池, and the trunk is still the 叡山本線.
  assert.deepEqual(lines(journey("kyoto", "八瀬比叡山口駅", "鞍馬駅")), ["叡山本線", "鞍馬線"]);
  oneRide("kyoto", "出町柳駅", "八瀬比叡山口駅", "叡山本線", { fromLine: "叡山本線" });
  oneRide("kyoto", "出町柳駅", "一乗寺駅", "叡山本線", { fromLine: "叡山本線" });
});

test("Yokohama: the 京浜東北線・根岸線 through 桜木町 is one ride", () => {
  // Was: 横浜駅 →(京浜東北線, 1)→ 桜木町駅 ⇄ 桜木町駅 →(根岸線, 2)→ 石川町駅, 20 min.
  const found = journey("yokohama", [35.4658, 139.6223], [35.4388, 139.6430]);
  assert.equal(rides(found), "横浜駅 →(京浜東北線・根岸線, 3)→ 石川町駅");
  assert.equal(found!.totalMinutes, 14);
  for (const station of ["山手駅", "根岸駅", "新杉田駅"]) oneRide("yokohama", "横浜駅", station, "京浜東北線・根岸線", { fromLine: "京浜東北線" });
  // Was: 関内 →(ブルーライン, 1)→ 桜木町 ⇄ 桜木町 →(京浜東北線, 1)→ 横浜.
  assert.equal(journey("yokohama", "関内駅", "横浜駅", { fromLine: "根岸線", toLine: "京浜東北線" })!.rides.length, 1);
  oneRide("yokohama", "桜木町駅", "鶴見駅", "京浜東北線", { fromLine: "京浜東北線" });
  // Every みなとみらい線 train comes off the 東横線.
  assert.equal(rides(journey("yokohama", "日吉駅", "元町・中華街駅", { fromLine: "東急東横線" })), "日吉駅 →(東急東横線・みなとみらい線, 13)→ 元町・中華街駅");
  // The subway's 高島町 is open (Wikidata's item also describes the Tōkyū station that closed in 2004).
  oneRide("yokohama", "横浜駅", "高島町駅", "横浜市営地下鉄ブルーライン", { fromLine: "横浜市営地下鉄ブルーライン" });
});

test("Fukuoka: the 福北ゆたか線 from 博多 to 城戸南蔵院前 is one ride", () => {
  // Was: JR博多駅 →(鹿児島本線, 1)→ 吉塚駅 ⇄ 吉塚駅 →(篠栗線, 2)→ 篠栗駅 ⇄ 篠栗駅 →(福北ゆたか線, 2)→ 城戸南蔵院前駅, 48 min.
  const found = oneRide("fukuoka", "博多駅", "城戸南蔵院前駅", "福北ゆたか線", { fromLine: "福北ゆたか線" });
  assert.equal(rides(found), "博多駅 →(福北ゆたか線, 8)→ 城戸南蔵院前駅");
  assert.ok(!networks.get("fukuoka")!.lines.some(([ja]) => ja === "篠栗線"));
  // 博多 to 吉塚 is still the 鹿児島本線 it mostly is.
  assert.equal(rides(journey("fukuoka", [33.5900, 130.4207], [33.6072, 130.424])), "博多駅 →(鹿児島本線, 1)→ 吉塚駅");
});

test("Nagoya: one 東海道本線 and one 中央本線, with every stop counted", () => {
  // Was: 名古屋駅 →(東海道線, 2)→ 笠寺駅 ⇄ 笠寺駅 →(東海道本線, 1)→ 大高駅, 40 min.
  assert.equal(rides(journey("nagoya", "名古屋駅", "大高駅", { fromLine: "東海道本線" })), "名古屋駅 →(東海道本線, 5)→ 大高駅");
  oneRide("nagoya", "金山駅", "大高駅", "東海道本線", { fromLine: "東海道本線" });
  // Was: 名古屋 → 熱田 "1 stop" on a link that skipped 尾頭橋 and 金山.
  assert.equal(rides(journey("nagoya", "名古屋駅", "熱田駅", { fromLine: "東海道本線" })), "名古屋駅 →(東海道本線, 3)→ 熱田駅");
  // Was: [中央本線 (名古屋地区)], one of three names for the line.
  oneRide("nagoya", "名古屋駅", "鶴舞駅", "中央本線", { fromLine: "中央本線" });
  const names = networks.get("nagoya")!.lines.map(([ja]) => ja);
  for (const gone of ["東海道線", "中央西線", "中央本線 (名古屋地区)", "ガイドウェイバス志段味線", "東部丘陵線", "幹栄1号系統"]) assert.ok(!names.includes(gone), `${gone} is still a line`);
  assert.ok(names.includes("リニモ") && names.includes("ゆとりーとライン"));
  // Was: 熱田駅 →(東海道本線, 1)→ 千種駅 — two stations with no train between them.
  assert.deepEqual(lines(journey("nagoya", "熱田駅", "千種駅", { toLine: "中央本線" })), ["東海道本線", "中央本線"]);
  // 東大手 is open (Wikidata records its closure of 1944–78): the 瀬戸線 reaches 栄町 again.
  assert.equal(rides(journey("nagoya", "栄町駅", "大曽根駅", { toLine: "名鉄瀬戸線" })), "栄町駅 →(名鉄瀬戸線, 5)→ 大曽根駅");
});

test("Tokyo: the 常磐線 from 品川 runs through to 北千住 and 松戸", () => {
  // Was: 品川駅 →(常磐線, 5)→ 三河島駅 ⇄ 三河島駅 →(常磐快速線, 2)→ 北千住駅.
  assert.equal(rides(journey("tokyo", "品川駅", "北千住駅", { fromLine: "常磐線（快速）", toLine: "常磐線（快速）" })), "品川駅 →(常磐線（快速）, 7)→ 北千住駅");
  oneRide("tokyo", "新橋駅", "北千住駅", "常磐線（快速）", { fromLine: "常磐線（快速）", toLine: "常磐線（快速）" });
  oneRide("tokyo", "上野駅", "松戸駅", "常磐線（快速）", { fromLine: "常磐線（快速）", toLine: "常磐線（快速）" });
});

test("Tokyo: the airport train from 品川 and 泉岳寺 is one ride", () => {
  // Was: 品川駅 →(京急本線, 10)→ 京急蒲田駅 ⇄ 京急蒲田駅 →(京急空港線, 6)→ 羽田空港第1・第2ターミナル駅, 58 min.
  const found = journey("tokyo", [35.6285, 139.7388], "羽田空港第1・第2ターミナル駅", { toLine: "京急空港線" });
  assert.equal(rides(found), "品川駅 →(京急空港線, 16)→ 羽田空港第1・第2ターミナル駅");
  assert.ok(found!.totalMinutes <= 45);
  oneRide("tokyo", "泉岳寺駅", "羽田空港第3ターミナル駅", "京急空港線", { fromLine: "京急本線", toLine: "京急空港線" });
  // Between 品川 and 京急蒲田 the line is still the 京急本線.
  oneRide("tokyo", "品川駅", "京急蒲田駅", "京急本線", { fromLine: "京急本線" });
});

test("Tokyo: 横須賀線 west of 東京, 総武線（快速） east of it, and one train through", () => {
  // Was: [横須賀・総武快速線] for all three.
  oneRide("tokyo", "東京駅", "武蔵小杉駅", "横須賀線", { fromLine: "横須賀線", toLine: "横須賀線" });
  oneRide("tokyo", "東京駅", "市川駅", "総武線（快速）", { fromLine: "総武線（快速）", toLine: "総武線（快速）" });
  assert.equal(rides(journey("tokyo", "品川駅", "錦糸町駅", { fromLine: "横須賀線", toLine: "総武線（快速）" })), "品川駅 →(横須賀線・総武線（快速）, 5)→ 錦糸町駅");
  // 東京 to 舞浜 is the 京葉線, whose track it is — not the 武蔵野線 trains that share it.
  oneRide("tokyo", "東京駅", "舞浜駅", "京葉線", { fromLine: "京葉線" });
});

test("Kobe, Osaka and Hiroshima: through services ride as one", () => {
  // Was: 三ノ宮駅 →(JR神戸線, 5)→ 鷹取駅 ⇄ 鷹取駅 →(山陽本線, 2)→ 須磨駅.
  assert.equal(rides(journey("kobe", "三ノ宮駅", "須磨駅")), "三ノ宮駅 →(JR神戸線, 7)→ 須磨駅");
  // Was: [東海道本線] east of 三ノ宮, [JR神戸線] west of it.
  oneRide("kobe", "三ノ宮駅", "住吉駅", "JR神戸線", { toLine: "JR神戸線" });
  // Was: 三宮駅 →(西神・山手線, 1)→ 新神戸駅 ⇄ 新神戸駅 →(北神線, 1)→ 谷上駅.
  assert.equal(rides(journey("kobe", "三宮駅", "谷上駅", { fromLine: "西神・山手線" })), "三宮駅 →(西神・山手線・北神線, 2)→ 谷上駅");
  // Was: 梅田駅 →(御堂筋線, 5)→ 江坂駅 ⇄ 江坂駅 →(南北線, 3)→ 千里中央駅.
  assert.equal(rides(journey("osaka", "梅田駅", "千里中央駅", { toLine: "北大阪急行" })), "梅田駅 →(御堂筋線・北大阪急行, 8)→ 千里中央駅");
  // 大阪 is where the JR京都線 becomes the JR神戸線; the train does not stop being one.
  assert.equal(rides(journey("osaka", "新大阪駅", "尼崎駅", { fromLine: "JR京都線", toLine: "JR神戸線" })), "新大阪駅 →(JR京都線・JR神戸線, 3)→ 尼崎駅");
  oneRide("osaka", "大阪駅", "吹田駅", "JR京都線");
  oneRide("osaka", "大阪駅", "西宮駅", "JR神戸線", { toLine: "JR神戸線" });
  // Was: 広島駅 →(山陽本線, 3)→ 海田市駅 ⇄ 海田市駅 →(呉線, 10)→ 呉駅.
  assert.equal(rides(journey("hiroshima", "広島駅", "呉駅", { fromLine: "山陽本線" })), "広島駅 →(呉線, 13)→ 呉駅");
  // Was: 広島駅 →(可部線, 2)→ 三滝駅 on a link that skipped 新白島.
  assert.equal(rides(journey("hiroshima", "広島駅", "三滝駅", { fromLine: "山陽本線" })), "広島駅 →(可部線, 3)→ 三滝駅");
  // On the trunk itself the name is still the trunk's.
  oneRide("hiroshima", "広島駅", "海田市駅", "山陽本線", { fromLine: "山陽本線" });
});

// ---------------------------------------------------------------------------
// Nothing a visitor cannot board with an ordinary ticket
// ---------------------------------------------------------------------------

test("Sendai: the railway that closed in 1960 is not a ride", () => {
  // Was: 東照宮駅 →(仙台鉄道, 1)→ 八乙女駅 ⇄ 八乙女駅 →(仙台市営地下鉄南北線, 1)→ 泉中央駅.
  assert.equal(rides(journey("sendai", [38.2797, 140.8835], [38.3225, 140.8813])), "台原駅 →(仙台市営地下鉄南北線, 4)→ 泉中央駅");
  assert.deepEqual(lines(journey("sendai", [38.2773, 140.8866], [38.3129, 140.884])), ["仙山線", "仙台市営地下鉄南北線"]);
  assert.ok(!networks.get("sendai")!.lines.some(([ja, en]) => /仙台鉄道/.test(`${ja}${en}`)));
});

test("Tokyo: no ride on freight track — 田端 is on the 山手線, and 隅田川駅 is a freight terminal", () => {
  // Was: 田端駅 →(常磐線, 4)→ 東京駅 over the freight link 田端–三河島.
  assert.equal(rides(journey("tokyo", "田端駅", "東京駅", { toLine: "山手線" })), "田端駅 →(山手線, 8)→ 東京駅");
  oneRide("tokyo", "田端駅", "品川駅", "山手線", { toLine: "山手線" });
  assert.deepEqual(lines(journey("tokyo", "田端駅", "舞浜駅")), ["山手線", "京葉線"]);
  // Was: 浜松町駅 →(東海道貨物線, 1)→ 浜川崎駅, 35 min.
  assert.deepEqual(lines(journey("tokyo", "浜松町駅", "浜川崎駅")), ["京浜東北線", "南武線"]);
  for (const line of lines(journey("tokyo", "東京駅", "浜川崎駅", { fromLine: "山手線" }))) assert.ok(!/貨物/.test(line));
  // Was: a one-minute walk to 隅田川駅 and →(常磐線, 3)→ 上野駅.
  assert.equal(journey("tokyo", [35.7331, 139.8008], [35.7138, 139.7773])!.walkToStation, "南千住駅");
  const stations = networks.get("tokyo")!.stations.map(([ja]) => ja);
  for (const yard of ["隅田川駅", "浮島町駅", "越中島貨物駅"]) assert.ok(!stations.includes(yard), `${yard} is on the map`);
});

test("Yokohama: the port's freight lines and yards are not on the map", () => {
  const yokohama = networks.get("yokohama")!;
  const stations = yokohama.stations.map(([ja]) => ja);
  for (const yard of ["東高島駅", "横浜羽沢駅", "横浜本牧駅", "本牧埠頭駅"]) assert.ok(!stations.includes(yard), `${yard} is on the map`);
  for (const [ja] of yokohama.lines) assert.ok(!/本牧線|羽沢線|高島線|貨物/.test(ja), `${ja} is a freight line`);
  // Was: … ⇄ 根岸駅 →(本牧線, 1)→ 横浜本牧駅 and an 18-minute walk. 三溪園 has no station; the answer is no train.
  assert.equal(rides(journey("yokohama", [35.4658, 139.6223], [35.4169, 139.6606])), "no train");
  assert.equal(rides(journey("yokohama", [35.4158, 139.635], [35.4205, 139.6713])), "no train");
  // Was: a walk to 東高島駅 and →(東海道本線, 1)→ 鶴見駅.
  assert.equal(rides(journey("yokohama", [35.4714, 139.6362], "鶴見駅")), "東神奈川駅 →(京浜東北線, 2)→ 鶴見駅");
  // Was: 東戸塚駅 →(東海道本線, 2)→ 鶴見駅 by way of the freight yard at 横浜羽沢.
  assert.deepEqual(lines(journey("yokohama", [35.43, 139.5567], "鶴見駅")), ["横須賀線", "京浜東北線"]);
});

test("Seoul: no KTX, ITX or Mugunghwa across the city, and the subway lines are 「N号線」", () => {
  // Was: ソウル駅 →(韓国高速鉄道, 1)→ 清凉里駅, 18 min.
  assert.equal(rides(journey("seoul", [37.5547, 126.9707], [37.5803, 127.0470])), "ソウル駅 →(1号線, 9)→ 清凉里駅");
  // Was: ソウル駅 →(京釜線（ムグンファ号）, 1)→ 龍山駅.
  assert.deepEqual(lines(journey("seoul", [37.5547, 126.9707], [37.5298, 126.9648])), ["1号線"]);
  // Was: [首都圏電鉄4号線] and [ソウル交通公社2号線].
  assert.equal(rides(journey("seoul", "明洞駅", "蚕室駅", { toLine: "2号線" })), "明洞駅 →(4号線, 2)→ 東大門歴史文化公園駅 ⇄ 東大門歴史文化公園駅 →(2号線, 11)→ 蚕室駅");
  assert.deepEqual(lines(journey("seoul", "明洞駅", "蚕室駅", { toLine: "2号線", language: "en" })), ["Line 4", "Line 2"]);
  for (const [ja, en] of networks.get("seoul")!.lines) assert.ok(!/韓国高速鉄道|Korea Train|ムグンファ|ITX|DMZ|首都圏電鉄\d|ソウル交通公社\d|ソウル市メトロ\d/.test(`${ja} ${en}`), `${ja} / ${en}`);
});

test("Osaka and Nagoya: a wrong link and a bus stop are not a train", () => {
  // Was: 出屋敷駅 →(?, 1)→ 尼崎駅 — Hanshin's 出屋敷 joined to JR 尼崎, two kilometres from Hanshin 尼崎.
  assert.equal(rides(journey("osaka", [34.7182, 135.4046], [34.7317, 135.4317])), "no train");
  // Was: 市役所停留所 →(?, 1)→ 基幹バス清水口停留所, a city bus printed as a train.
  assert.equal(rides(journey("nagoya", [35.182, 136.9053], [35.1832, 136.9136])), "no train");
});

// ---------------------------------------------------------------------------
// Trams and other stop-only systems
// ---------------------------------------------------------------------------

test("Hakodate: one tram ride is one ride", () => {
  // Was: five rides with two walks between neighbouring stops, 65 min.
  const found = journey("hakodate", "函館駅前", "湯の川");
  assert.equal(rides(found), "函館駅前 →(函館市電, 16)→ 湯の川");
  assert.ok(found!.totalMinutes <= 30);
  oneRide("hakodate", "湯の川", "十字街", "函館市電");
  // Was: a 12-minute walk to 新川町 to board. The stop outside the station is 函館駅前.
  const fromStation = journey("hakodate", [41.7737, 140.7264], [41.78, 140.785]);
  assert.equal(fromStation!.walkToStation, "函館駅前");
  assert.equal(fromStation!.rides.length, 1);
  // Was (en): 函館駅前停留場 →(Main Line, …) — Japanese in English, and a name shared with JR's Hakodate Main Line.
  assert.equal(rides(journey("hakodate", [41.7737, 140.7264], [41.7731, 140.704], { language: "en" })), "Hakodate-Ekimae →(Hakodate City Tram, 6)→ Hakodate-Dokku-Mae Station");
});

test("Nagasaki: trams are named by the routes a visitor boards, never the once-a-day route 2", () => {
  // Was: 長崎駅前停留場 →(長崎電気軌道2号系統, 8)→ 平和公園停留場.
  assert.equal(rides(journey("nagasaki", [32.7523, 129.8700], [32.7745, 129.8640])), "長崎駅前 →(1号系統, 8)→ 平和公園");
  assert.deepEqual(lines(journey("nagasaki", [32.7523, 129.8700], [32.7343, 129.8700])), ["1号系統", "5号系統"]);
  assert.equal(journey("nagasaki", [32.7436, 129.8730], [32.7510, 129.8930])!.rides.length, 1);
  assert.equal(rides(journey("nagasaki", "長崎駅前", "新地中華街")), "長崎駅前 →(1号系統, 4)→ 新地中華街");
  assert.ok(!networks.get("nagasaki")!.lines.some(([ja, en]) => /2号系統|Route 2\b/.test(`${ja} ${en}`)));
});

test("Hiroshima: the JR station is reached past the tram stops, and the Astram Line is one line", () => {
  // Was: two tram rides to 広島駅 first, 95 min, because eight tram stops filled the list of stations to try.
  assert.equal(rides(journey("hiroshima", [34.39991, 132.46627], [34.24114, 132.55581])), "広島駅 →(呉線, 13)→ 呉駅");
  // Was: [広島新交通1号線].
  assert.equal(rides(journey("hiroshima", "本通駅", "大町駅", { toLine: "アストラムライン" })), "本通駅 →(アストラムライン, 11)→ 大町駅");
  // The stale item for the stop that became 紙屋町東 and 紙屋町西 in 2001 is gone.
  const stations = networks.get("hiroshima")!.stations.map(([ja]) => ja);
  assert.ok(!stations.includes("紙屋町") && stations.includes("紙屋町東駅") && stations.includes("紙屋町西駅"));
  // One tram, named by its route.
  assert.equal(rides(journey("hiroshima", "広島駅", "原爆ドーム前", { fromLine: "広島電鉄2号線" })), "広島駅 →(広島電鉄2号線, 8)→ 原爆ドーム前");
});

test("Venice and Melbourne: a stop is one stop, and a loop tram is one tram", () => {
  // Was: no train — line 2 calls at pontoon "A" of Accademia and leaves from "B".
  assert.equal(rides(journey("venice", [45.43444, 12.33972], [45.43361, 12.32806])), "San Marco Giardinetti →(ACTV service 2, 2)→ San Samuele");
  assert.ok(!networks.get("venice")!.stations.some(([ja]) => /"[A-Z]"$/.test(ja)));
  // Was: no train, and a change onto route 75 — the City Circle had lost Flinders Street.
  assert.equal(rides(journey("melbourne", [-37.8061, 144.9717], [-37.8180, 144.9691])), "Nicholson St/Victoria Pde (Carlton) →(シティサークル, 4)→ Russell St/Flinders St (Melbourne City)");
  assert.deepEqual(lines(journey("melbourne", [-37.8061, 144.9717], [-37.8208, 144.9580])), ["シティサークル"]);
});

test("Amsterdam: a tram ride carries the number on the tram, and one tram is one ride", () => {
  // Was (before the maps were regenerated): a nameless ride over any tram track, as if one tram ran everywhere.
  assert.equal(rides(journey("amsterdam", "Alexanderplein", "Rijksmuseum", { toLine: "Tram line 19" })), "Alexanderplein →(Tram line 19, 5)→ Rijksmuseum");
  assert.equal(networks.get("amsterdam")!.edges.filter((edge) => edge[2] < 0).length, 0);
});

test("a ride with no line of its own takes the line it is part of", () => {
  // Was: [猫空ロープウェイ] ⇄ [?] ⇄ [Taipei Zoo Station] — one gondola, three labels.
  assert.deepEqual(lines(journey("taipei", "Taipei Zoo Station", "猫空駅", { fromLine: "猫空ロープウェイ" })), ["猫空ロープウェイ"]);
  // Was: Tung Chung Terminal →(?, 3)→ 昂坪駅 — the cable car printed as "train".
  assert.deepEqual(lines(journey("hongkong", [22.2893, 113.9414], [22.2563, 113.9014])), ["昂坪360"]);

  // The router's own rule, on a toy line A–B–C–D whose middle link has no line:
  const stations: RailNetworkData["stations"] = [["A駅", "A", 35, 139], ["B駅", "B", 35, 139.02], ["C駅", "C", 35, 139.04], ["D駅", "D", 35, 139.06]];
  const gap = new RailNetwork({ id: "toy", stations, lines: [["東線", "East Line"]], edges: [[0, 1, 0], [1, 2, -1], [2, 3, 0]] });
  const ride = gap.route({ latitude: 35, longitude: 139 }, { latitude: 35, longitude: 139.06 });
  // One ride on 東線, not 東線 ⇄ 電車 ⇄ 東線.
  assert.equal(rides(ride), "A駅 →(東線, 3)→ D駅");
  // A change onto a different named line after the nameless link is still a change.
  const two = new RailNetwork({ id: "toy", stations, lines: [["東線", "East Line"], ["西線", "West Line"]], edges: [[0, 1, 0], [1, 2, -1], [2, 3, 1]] });
  assert.equal(two.route({ latitude: 35, longitude: 139 }, { latitude: 35, longitude: 139.06 })!.rides.length, 2);
});

// ---------------------------------------------------------------------------
// Names as on the signs
// ---------------------------------------------------------------------------

test("line names are the ones on the signs", () => {
  // Was: [北陸本線] — the IRいしかわ鉄道線 since 2024-03-16; and [七尾線] to 森本.
  for (const station of ["西金沢駅", "東金沢駅", "森本駅", "松任駅"]) oneRide("kanazawa", "金沢駅", station, "IRいしかわ鉄道線");
  assert.ok(!networks.get("kanazawa")!.lines.some(([ja]) => ja === "北陸本線"));
  // Was: [横須賀・総武快速線].
  assert.equal(rides(journey("kamakura", [35.3190, 139.5505], "北鎌倉駅")), "鎌倉駅 →(横須賀線, 1)→ 北鎌倉駅");
  // Was: [江の島線], which reads as the Odakyū or the Enoden.
  oneRide("kamakura", "大船駅", "湘南江の島駅", "湘南モノレール", { fromLine: "湘南モノレール" });
  // Was: [小田急箱根鉄道線] and [小田急箱根鋼索線].
  oneRide("hakone", "小田原駅", "強羅駅", "箱根登山電車", { fromLine: "箱根登山電車" });
  oneRide("hakone", "強羅駅", "早雲山駅", "箱根登山ケーブルカー", { fromLine: "箱根登山ケーブルカー", toLine: "箱根登山ケーブルカー" });
  // Was: [中央・総武緩行線], [ゆりかもめ東京臨海新交通臨海線], [舞浜リゾートラインディズニーリゾートライン線].
  const tokyo = networks.get("tokyo")!.lines.map(([ja]) => ja);
  for (const name of ["中央・総武線（各駅停車）", "中央線（快速）", "常磐線（各駅停車）", "ゆりかもめ", "ディズニーリゾートライン", "東京モノレール"]) assert.ok(tokyo.includes(name), `${name} is missing`);
  assert.equal(rides(journey("tokyo", [35.6259, 139.7714], "新橋駅", { toLine: "ゆりかもめ" })), "台場駅 →(ゆりかもめ, 6)→ 新橋駅");
  // Was: [桜島線], [片町線], [東海道本線] for the JR京都線; 新大阪 → 大阪 named after the おおさか東線.
  assert.deepEqual(lines(journey("osaka", "大阪駅", "ユニバーサルシティ駅")), ["大阪環状線", "JRゆめ咲線"]);
  oneRide("osaka", "京橋駅", "住道駅", "学研都市線", { fromLine: "学研都市線" });
  assert.equal(rides(journey("osaka", [34.7335, 135.5003], [34.7025, 135.4959])), "新大阪駅 →(JR京都線, 1)→ 大阪駅");
  oneRide("osaka", "天王寺駅", "久宝寺駅", "大和路線", { fromLine: "大和路線" });
  // Was: [札沼線], [一条・山鼻軌道線], [桜井線], [京福電気鉄道嵐山本線], [みなとみらい21線].
  oneRide("sapporo", "札幌駅", "あいの里教育大駅", "学園都市線");
  assert.ok(networks.get("sapporo")!.lines.some(([ja]) => ja === "札幌市電"));
  oneRide("nara", "奈良駅", "天理駅", "万葉まほろば線", { toLine: "万葉まほろば線" });
  assert.ok(networks.get("kyoto")!.lines.some(([ja, en]) => ja === "嵐電嵐山本線" && en === "Randen Arashiyama Line"));
  assert.ok(networks.get("yokohama")!.lines.some(([ja]) => ja === "みなとみらい線"));
  // Was (en): 阪神神戸高速線 = "Tōzai Line", 神戸電鉄神戸高速線 = "Namboku Line".
  const kobe = new Map(networks.get("kobe")!.lines.map(([ja, en]) => [ja, en]));
  assert.equal(kobe.get("阪神神戸高速線"), "Hanshin Kobe Kosoku Line");
  assert.equal(kobe.get("神戸電鉄神戸高速線"), "Shintetsu Kobe Kosoku Line");
});

test("station names are the ones on the signs, in both languages", () => {
  // Was: つくばエクスプレス秋葉原駅 / "Tsukuba Express Akihabara Station".
  const akihabara: [number, number] = [35.6984, 139.7731];
  assert.equal(rides(journey("tokyo", akihabara, "北千住駅", { toLine: "つくばエクスプレス" })), "秋葉原駅 →(つくばエクスプレス, 4)→ 北千住駅");
  assert.equal(rides(journey("tokyo", akihabara, "北千住駅", { toLine: "つくばエクスプレス", language: "en" })), "Akihabara Station →(Tsukuba Express, 4)→ Kita-Senju Station");
  // Was: ゆりかもめ新橋駅, JR博多駅 / "JR Hakata Station".
  for (const [city, glued] of [["tokyo", /^(ゆりかもめ|つくばエクスプレス).+駅$|^(Yurikamome|Tsukuba Express) .+Station$/], ["fukuoka", /^JR博多駅$|^JR Hakata Station$/]] as const) {
    assert.deepEqual(networks.get(city)!.stations.filter(([ja, en]) => glued.test(ja) || glued.test(en)), []);
  }
  assert.equal(rides(journey("fukuoka", [33.5900, 130.4207], [33.6072, 130.424], { language: "en" })), "Hakata Station →(Kagoshima Main Line, 1)→ Yoshizuka Station");
  // Was (en): "Hakata Station →(…)→ Yakuin ⇄ Yakuin Station →(…)" — the same building under two forms.
  assert.equal(journey("fukuoka", "博多駅", "太宰府駅", { fromLine: "七隈線", language: "en" })!.rides[0].to, "Yakuin Station");
  // A tram stop is named as on the stop's sign, without 停留場; a bus stop is not on a rail map at all.
  for (const [id, data] of networks) {
    for (const [ja, en] of data.stations) assert.ok(!/(停留場|停留所|バス停)$/.test(ja) && !/\bBus Stop\b/i.test(en), `${id}: ${ja} / ${en}`);
  }
  // In Japan a 駅 is "… Station" in English, every time.
  for (const id of ["tokyo", "osaka", "kyoto", "fukuoka", "sendai", "nagoya"]) {
    for (const [ja, en] of networks.get(id)!.stations) if (/駅$/.test(ja) && /^[\x20-\x7eÀ-ɏ’‘]+$/.test(en)) assert.ok(/station/i.test(en), `${id}: ${ja} / ${en}`);
  }
});

test("English mode does not print Japanese line names", () => {
  // Was: [東京メトロ丸ノ内線方南町支線] in an English journey.
  assert.deepEqual(lines(journey("tokyo", "新宿駅", "方南町駅", { fromLine: "都営地下鉄大江戸線", language: "en" })), ["Toei Ōedo Line", "Marunouchi Line (Hōnanchō Branch)"]);
  // Was: [Tsurumi Line] ⇄ [鶴見線海芝浦支線] ⇄ [Tsurumi Line]; the branches are signed 鶴見線.
  assert.equal(rides(journey("yokohama", "鶴見駅", "海芝浦駅", { fromLine: "鶴見線", language: "en" })), "Tsurumi Station →(Tsurumi Line, 6)→ Umi-Shibaura Station");
  const japanese = /[぀-ヿ一-鿿]/;
  for (const id of ["tokyo", "yokohama", "kamakura", "hakone", "nikko", "osaka", "kyoto", "nara", "kobe", "nagoya", "kanazawa", "hiroshima", "fukuoka", "nagasaki", "sapporo", "hakodate", "sendai", "naha"]) {
    for (const [ja, en] of networks.get(id)!.lines) assert.ok(!japanese.test(en), `${id}: ${ja} has no English name (${en})`);
    for (const [ja, en] of networks.get(id)!.stations) assert.ok(!japanese.test(en), `${id}: ${ja} has no English name (${en})`);
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("which of several parallel services names a ride does not depend on the order of the file", () => {
  const cases: Array<[string, Place, Place]> = [
    ["nagasaki", [32.7523, 129.8700], [32.7745, 129.8640]],
    ["nagasaki", [32.7436, 129.8730], [32.7510, 129.8930]],
    ["osaka", [34.7335, 135.5003], [34.7025, 135.4959]],
    ["tokyo", [35.6812, 139.7671], [35.6329, 139.8804]],
    ["tokyo", [35.7138, 139.7773], [35.6812, 139.7671]],
    ["kanazawa", [36.5781, 136.6480], [36.5937, 136.6697]],
    ["hiroshima", [34.3976, 132.4754], [34.3961, 132.4541]],
    ["melbourne", [-37.8061, 144.9717], [-37.8180, 144.9691]],
    ["berlin", [52.5251, 13.3694], [52.5219, 13.4132]],
  ];
  for (const [city, from, to] of cases) {
    const data = networks.get(city)!;
    const expected = rides(journey(city, from, to));
    assert.notEqual(expected, "no train", `${city}: the case has no train`);
    // The same links and lines, listed the other way round and renumbered.
    const lineOrder = data.lines.map((_, index) => data.lines.length - 1 - index);
    const reversed: RailNetworkData = {
      ...data,
      lines: [...data.lines].reverse(),
      edges: [...data.edges].reverse().map(([a, b, line, guest]) => (guest ? [a, b, line < 0 ? line : lineOrder[line], guest] : [a, b, line < 0 ? line : lineOrder[line]]) as RailNetworkData["edges"][number]),
      through: data.through?.map((group) => group.map((line) => lineOrder[line])),
    };
    const other = new RailNetwork(reversed).route(point(city, from), point(city, to), "ja");
    assert.deepEqual(lines(other), lines(journey(city, from, to)), `${city}: the line named depends on file order`);
  }
  // Of the services that cover a whole ride, the busiest names it: route 1 (26 links) over route 3 (24) at Nagasaki.
  assert.deepEqual(lines(journey("nagasaki", [32.7523, 129.8700], [32.7745, 129.8640])), ["1号系統"]);
});

// ---------------------------------------------------------------------------
// Every network
// ---------------------------------------------------------------------------

/** Ordinary lines whose names contain 高速 ("rapid") — the company's name, not the train's speed. */
const ordinaryDespiteName = new Set(["東京臨海高速鉄道りんかい線", "埼玉高速鉄道線", "東葉高速線", "阪神神戸高速線", "阪急神戸高速線", "神戸電鉄神戸高速線"]);
const freight = /貨物|臨海鉄道|freight|\bgoods\b|industrial spur/i;
const reserved = /新幹線|Shinkansen|\bKTX\b|\bSRT\b|韓国高速鉄道|Korea Train eXpress|ムグンファ|Mugunghwa|ITX|セマウル|Saemaeul|DMZ|高速|high[- ]speed|\bTGV\b|\bLGV\b|Acela|アセラ|Express Rail Link|\bICE\b|\bIC\b|\bECE?\b|Inter-?City|インターシティ|都市間鉄道|城際|Adirondack|Maple Leaf|Empire Service|Ethan Allen|Southwest Chief|Coast Starlight/i;
const closedOrNotRail = /仙台鉄道|^本牧線$|^羽沢線$|^高島線$|越中島支線|Bus Route|cycle shuttle|River Tours|^Former |廃線|廃止/i;

test("no network has a freight line, a high-speed or reserved intercity service, a closed railway or a bus route", () => {
  for (const [id, data] of networks) {
    for (const [ja, en] of data.lines) {
      if (ordinaryDespiteName.has(ja)) continue;
      for (const [what, pattern] of [["a freight line", freight], ["a high-speed or intercity service", reserved], ["closed, or not a railway", closedOrNotRail]] as const) {
        assert.ok(!pattern.test(ja) && !pattern.test(en), `${id}: ${ja} / ${en} is ${what}`);
      }
      assert.ok(!/駅$|\bstation$/i.test(ja) && !/\bstation$/i.test(en), `${id}: the line "${ja}" is a station's name`);
    }
  }
  // The allow-list is not a blanket: each of those lines is really there.
  const all = new Set([...networks.values()].flatMap((data) => data.lines.map(([ja]) => ja)));
  for (const name of ["東京臨海高速鉄道りんかい線", "埼玉高速鉄道線", "東葉高速線", "阪神神戸高速線"]) assert.ok(all.has(name), `${name} has gone`);
});

/*
 * A line in two pieces is where a phantom change comes from: the train
 * runs on, the name stops. Every named line must be one connected run of
 * links. The exceptions are listed with the reason — nearly all are the
 * edge of the map (the middle of the line is outside the city's radius) or
 * a link Wikidata does not have, which no rule here can supply.
 */
const linesInPieces: Record<string, { lines: string[]; why: string }> = {
  tokyo: { lines: ["武蔵野線"], why: "the map ends between 南越谷 and 新三郷; both ends of the gap are 20 km from the centre" },
  yokohama: { lines: ["横浜市営地下鉄グリーンライン"], why: "センター北 and 北山田 are outside the map's radius, between センター南 and 東山田" },
  nagoya: { lines: ["名鉄尾西線"], why: "the map ends between 苅安賀 and 上丸渕; the stations between them are outside its radius" },
  bangkok: { lines: ["東本線"], why: "Wikidata has no link across the gap" },
  barcelona: { lines: ["バルセロナ地下鉄9号線", "バルセロナ地下鉄10号線"], why: "the two halves of L9/L10 are not joined yet: the central section is unbuilt" },
  beijing: { lines: ["北京地下鉄3号線", "豊双線"], why: "Wikidata has no link across the gap" },
  berlin: { lines: ["ベルリン環状線"], why: "only two stretches carry the track's own name; the S-Bahn services name the rest" },
  budapest: { lines: ["トラム"], why: "the catch-all name for tram stretches whose route numbers do not join up; the stretches are apart" },
  florence: { lines: ["フィレンツェ＝ファエンツァ線"], why: "Wikidata has no link across the gap" },
  kualalumpur: { lines: ["ラピドKLBRTサンウェイ線"], why: "Wikidata has no link across the gap" },
  london: {
    lines: ["トラム", "ブライトン本線", "サットン&モール・ヴァレー・ラインズ", "Stratford International/Woolwich Arsenal service", "イーストロンドン線", "リー・ヴァレー・ラインズ", "Tramlink route 1", "Tramlink route 2", "ドックランズ・ライト・レイルウェイ", "ロンドン・ケーブルカー"],
    why: "National Rail and DLR links with no line recorded lie between the pieces; the tram stretches without a route are apart",
  },
  madrid: { lines: ["Line C-7"], why: "Wikidata has no link across the gap" },
  melbourne: { lines: ["メルボルン地下鉄"], why: "Wikidata has no link across the gap" },
  milan: { lines: ["ミラノ近郊鉄道S9線", "Milan–Saronno railway"], why: "Wikidata has no link across the gap" },
  munich: { lines: ["S7", "ミュンヒェン-ホルツキルヒェン線"], why: "Wikidata has no link across the gap" },
  newyork: { lines: ["ニューヨーク市地下鉄4系統", "<F>"], why: "Wikidata has no link across the gap" },
  paris: { lines: ["RER C線"], why: "Wikidata has no link across the gap" },
  prague: { lines: ["トラム"], why: "the catch-all name for tram stretches with no route in Wikidata; the stretches are apart" },
  sanfrancisco: { lines: ["青線", "水上バス", "トラム"], why: "two lines share the name 青線 / Blue Line; the ferry and tram stretches without a service are apart" },
  seoul: { lines: ["京義急行 (龍山)", "議政府軽電鉄", "京義急行", "京春線", "京釜線", "京義線"], why: "express services and track names recorded on scattered links; the numbered lines are whole" },
  sydney: { lines: ["バンクスタウン線", "Main Suburban railway line"], why: "Wikidata has no link across the gap" },
  taipei: { lines: ["台北捷運環状線"], why: "Wikidata has no link across the gap" },
  vancouver: { lines: ["エキスポライン"], why: "Wikidata has no link across the gap" },
  vienna: { lines: ["トラム"], why: "the catch-all name for tram stretches whose route numbers do not join up; the stretches are apart" },
};

test("every named line is one connected run of links, or the gap is explained", () => {
  for (const [id, data] of networks) {
    const inPieces: string[] = [];
    data.lines.forEach(([ja], line) => {
      const neighbours = new Map<number, number[]>();
      for (const [a, b, of] of data.edges) {
        if (of !== line) continue;
        neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
        neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
      }
      const seen = new Set<number>([[...neighbours.keys()][0]]);
      for (const queue = [...seen]; queue.length > 0;) for (const next of neighbours.get(queue.pop()!)!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      if (seen.size !== neighbours.size) inPieces.push(ja);
    });
    assert.deepEqual(inPieces.sort(), [...(linesInPieces[id]?.lines ?? [])].sort(), `${id}: lines in pieces (${linesInPieces[id]?.why ?? "none expected"})`);
  }
  for (const [id, entry] of Object.entries(linesInPieces)) assert.ok(networks.has(id) && entry.why.length > 20, `${id}: stale or unexplained`);
});

test("through-running groups and guest marks are well formed", () => {
  for (const [id, data] of networks) {
    for (const group of data.through ?? []) {
      assert.ok(group.length >= 2 && new Set(group).size === group.length, `${id}: a through group needs two different lines`);
      for (const line of group) assert.ok(data.lines[line], `${id}: a through group names a missing line`);
    }
    const between = new Map<string, number>();
    for (const [a, b] of data.edges) between.set(`${a}-${b}`, (between.get(`${a}-${b}`) ?? 0) + 1);
    for (const edge of data.edges) {
      assert.ok(edge.length === 3 || edge[3] === 1, `${id}: a link's fourth number is 1 or absent`);
      // A guest is a guest of something: another line runs between the same two stations.
      if (edge[3] === 1) assert.ok(between.get(`${edge[0]}-${edge[1]}`)! >= 2 && edge[2] >= 0, `${id}: a guest line is alone on its link`);
    }
    // No link is written twice.
    assert.equal(new Set(data.edges.map(([a, b, line]) => `${a}-${b}-${line}`)).size, data.edges.length, `${id}: a link is listed twice`);
  }
  // The groups the journeys above rely on.
  const group = (id: string) => (networks.get(id)!.through ?? []).map((lines) => lines.map((line) => networks.get(id)!.lines[line][0]).sort().join("+")).sort();
  assert.deepEqual(group("kyoto"), ["JR京都線+琵琶湖線", "京阪本線+京阪鴨東線"]);
  assert.deepEqual(group("yokohama"), ["みなとみらい線+東急東横線", "京浜東北線+根岸線"]);
  assert.deepEqual(group("osaka"), ["JR京都線+JR神戸線", "JR東西線+学研都市線", "北大阪急行+御堂筋線"]);
  assert.deepEqual(group("kobe"), ["北神線+西神・山手線"]);
});
