import assert from "node:assert/strict";
import test from "node:test";

import { budgetLabel, fetchHotpepperShops, inJapan, lunchPrice, parseHotpepperShops, shopsForMeal } from "../lib/hotpepper-client.ts";

const NEAR = { latitude: 35.6638, longitude: 139.7812 };
const shop = (over: Record<string, unknown> = {}) => ({
  id: "J000972601", name: "まぐろ家 月島西仲店", latitude: 35.66407, longitude: 139.78186, address: "東京都中央区月島1-20-5",
  genre: "お好み焼き・もんじゃ", budget: "3001～4000円", budgetAverage: "2,000円(通常平均)", catch: "海鮮", open: "11:30～23:00",
  photo: "https://imgfp.hotp.jp/IMGH/47/03/P045184703/P045184703_238.jpg", url: "https://www.hotpepper.jp/strJ000972601/?vos=x", ...over,
});

test("shops come back nearest first with their distance, photo and budget", () => {
  const far = shop({ id: "far", name: "遠い店", latitude: 35.6700, longitude: 139.7900 });
  const shops = parseHotpepperShops({ results: [far, shop()] }, NEAR);
  assert.deepEqual(shops.map((entry) => entry.name), ["まぐろ家 月島西仲店", "遠い店"]);
  assert.ok(shops[0].distanceMeters < 100);
  assert.equal(shops[0].budget, "3001～4000円");
  assert.equal(shops[0].photo, "https://imgfp.hotp.jp/IMGH/47/03/P045184703/P045184703_238.jpg");
});

test("a photo or link that is not the provider's own is dropped, and a malformed shop is skipped", () => {
  const shops = parseHotpepperShops({ results: [
    shop({ photo: "https://evil.example/x.jpg", url: "javascript:alert(1)" }),
    shop({ id: "b", name: "", latitude: 35.66 }),
    shop({ id: "c", latitude: "x" }),
    null,
  ] }, NEAR);
  assert.equal(shops.length, 1);
  assert.equal(shops[0].photo, null);
  assert.equal(shops[0].url, null);
  assert.deepEqual(parseHotpepperShops({ results: "no" }, NEAR), []);
  assert.deepEqual(parseHotpepperShops(null, NEAR), []);
});

test("the lookup asks the relay for the food operation and survives a failing relay", async () => {
  const asked: string[] = [];
  const ok = await fetchHotpepperShops({ near: NEAR, withinMeters: 1000, meal: "lunch", name: "もんじゃ" }, "/api/apple.php", async (input) => {
    asked.push(String(input));
    return new Response(JSON.stringify({ results: [shop()] }), { status: 200 });
  });
  assert.equal(ok.length, 1);
  const url = new URL(asked[0]);
  assert.equal(url.searchParams.get("op"), "food");
  assert.equal(url.searchParams.get("near"), "35.66380,139.78120");
  assert.equal(url.searchParams.get("within"), "1000");
  assert.equal(url.searchParams.get("meal"), "lunch");
  assert.equal(url.searchParams.get("name"), "もんじゃ");
  assert.deepEqual(await fetchHotpepperShops({ near: NEAR }, "/api/apple.php", async () => { throw new Error("offline"); }), []);
  assert.deepEqual(await fetchHotpepperShops({ near: NEAR }, "/api/apple.php", async () => new Response("{}", { status: 502 })), []);
  assert.deepEqual(await fetchHotpepperShops({ near: NEAR }, null), []);
});

test("a relay with no key is asked once and then left alone", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return new Response(JSON.stringify({ code: "not_configured" }), { status: 503 }); };
  assert.deepEqual(await fetchHotpepperShops({ near: NEAR }, "/api/apple.php", fetcher), []);
  assert.deepEqual(await fetchHotpepperShops({ near: NEAR }, "/api/apple.php", fetcher), []);
  assert.equal(calls, 1);
});

test("budget bands read as plain yen, and only Japan is asked about", () => {
  assert.equal(budgetLabel("2001～3000円"), "2,001〜3,000円");
  assert.equal(budgetLabel("～500円"), "〜500円");
  assert.equal(budgetLabel("30001円～"), "30,001円〜");
  assert.equal(budgetLabel(null), null);
  assert.equal(budgetLabel("未定"), null);
  assert.equal(inJapan({ latitude: 35.68, longitude: 139.76 }), true);
  assert.equal(inJapan({ latitude: 26.21, longitude: 127.68 }), true);
  assert.equal(inJapan({ latitude: 48.85, longitude: 2.35 }), false);
});

test("Japan is Japan, not the box around it: Korea and the Russian coast are outside, the far islands inside", () => {
  const inside: Array<[string, number, number]> = [
    ["Tokyo", 35.68, 139.76], ["Kyoto", 35.01, 135.77], ["Osaka", 34.69, 135.50], ["Hiroshima", 34.39, 132.46], ["Fukuoka", 33.59, 130.40],
    ["Nagasaki", 32.75, 129.87], ["Goto", 32.70, 128.84], ["Tsushima", 34.20, 129.29], ["Iki", 33.75, 129.69], ["Shimonoseki", 33.95, 130.94],
    ["Hagi", 34.41, 131.40], ["Matsue", 35.47, 133.05], ["Oki", 36.20, 133.33], ["Kanazawa", 36.56, 136.66], ["Sado", 38.02, 138.37],
    ["Niigata", 37.90, 139.02], ["Sendai", 38.27, 140.87], ["Aomori", 40.82, 140.74], ["Hakodate", 41.77, 140.73], ["Sapporo", 43.06, 141.35],
    ["Wakkanai", 45.41, 141.67], ["Nemuro", 43.33, 145.58], ["Kagoshima", 31.60, 130.56], ["Yakushima", 30.34, 130.51], ["Amami", 28.38, 129.49],
    ["Naha", 26.21, 127.68], ["Ishigaki", 24.34, 124.16], ["Yonaguni", 24.45, 123.00], ["Chichijima", 27.09, 142.19], ["Hachijo", 33.11, 139.79],
  ];
  for (const [name, latitude, longitude] of inside) assert.equal(inJapan({ latitude, longitude }), true, name);
  const outside: Array<[string, number, number]> = [
    ["Seoul", 37.57, 126.98], ["Busan", 35.18, 129.08], ["Jeju", 33.50, 126.53], ["Pohang", 36.03, 129.37], ["Ulleungdo", 37.50, 130.87],
    ["Wonsan", 39.15, 127.44], ["Vladivostok", 43.12, 131.89], ["Yuzhno-Sakhalinsk", 46.96, 142.73], ["Shanghai", 31.23, 121.47],
    ["Taipei", 25.03, 121.56], ["Hong Kong", 22.28, 114.15], ["Guam", 13.44, 144.79], ["Paris", 48.85, 2.35],
  ];
  for (const [name, latitude, longitude] of outside) assert.equal(inJapan({ latitude, longitude }), false, name);
});

test("a lunch price is read out of the free-text average only when it is named as lunch", () => {
  assert.equal(lunchPrice("ランチ 880円、ディナー1500-2000円"), "880円");
  assert.equal(lunchPrice("昼食800円～950円　　夜の飲食お客様平均単価3000円"), "800円");
  assert.equal(lunchPrice("2500円(通常平均)、3500円(宴会平均)、750円(ランチ平均)"), "750円");
  assert.equal(lunchPrice("ランチ：500～1500円　ディナー：3000～7000円"), "500円");
  assert.equal(lunchPrice("4500円、ランチ850円"), "850円");
  assert.equal(lunchPrice("3500円"), null);
  assert.equal(lunchPrice("1500円/5000円"), null);
  assert.equal(lunchPrice(null), null);
});

test("a lunch list puts places for eating with a lunch price first, izakaya after, and dinner is nearest first", () => {
  const at = (name: string, metres: number, genre: string, average: string | null) => ({
    ...parseHotpepperShops({ results: [shop({ id: name, name, genre, budgetAverage: average })] }, NEAR)[0], distanceMeters: metres,
  });
  const shops = [
    at("居酒屋A", 50, "居酒屋", "3000円"),
    at("居酒屋ランチ", 80, "居酒屋", "ランチ800円"),
    at("バル", 100, "ダイニングバー・バル", null),
    at("そば", 300, "和食", "ランチ900円"),
    at("カレー", 400, "アジア・エスニック料理", null),
    at("洋食", 600, "洋食", "ランチ1200円"),
    at("遠い定食", 1500, "和食", "ランチ700円"),
  ];
  // The live complaint: a lunch list that was nothing but izakaya.
  assert.deepEqual(shopsForMeal(shops, "lunch", 6).map((entry) => entry.name), ["そば", "洋食", "カレー", "居酒屋ランチ", "居酒屋A", "バル"]);
  assert.deepEqual(shopsForMeal(shops, "dinner", 3).map((entry) => entry.name), ["居酒屋A", "居酒屋ランチ", "バル"]);
  // Too few within a short walk: the far ones are used rather than an empty list.
  assert.deepEqual(shopsForMeal(shops.slice(5), "lunch", 6).map((entry) => entry.name), ["洋食", "遠い定食"]);
});

test("a break's cafés gain the guide's photos without changing who comes first", async () => {
  const { withListedCafes } = await import("../lib/shiori/cafes.ts");
  const from = { latitude: 35.0000, longitude: 135.0000 };
  const brk = { afterStop: 0, time: "15:00", reason: "after" as const, from, fromName: "寺", to: null, toName: null, search: from };
  const pick = (name: string, latitude: number, minutes: number) => ({ id: `apple-${name}`, name, address: "", latitude, longitude: 135, kind: "cafe" as const, detourMinutes: minutes, mapsUrl: "https://example.test" });
  const listed = (id: string, name: string, latitude: number, photo: string | null) => ({ id, name, latitude, longitude: 135, address: null, budget: "1001～1500円", photo, url: null });
  const merged = withListedCafes(
    [pick("スターバックス コーヒー 寺前店", 35.0010, 2), pick("喫茶 みどり", 35.0030, 6)],
    brk,
    [listed("a", "スターバックスコーヒー 寺前店", 35.00102, "https://imgfp.hotp.jp/a.jpg"), listed("b", "抹茶カフェ 葵", 35.0020, "https://imgfp.hotp.jp/b.jpg"), listed("c", "遠いカフェ", 35.0090, null)],
  );
  // The same café under two spellings is one entry, now with its photo and budget.
  assert.deepEqual(merged.map((entry) => entry.name), ["スターバックス コーヒー 寺前店", "抹茶カフェ 葵", "喫茶 みどり", "遠いカフェ"]);
  assert.equal(merged[0].photo, "https://imgfp.hotp.jp/a.jpg");
  assert.equal(merged[0].budget, "1001～1500円");
  assert.equal(merged[1].id, "hotpepper-b");
  assert.equal(merged[2].photo, undefined);
  // Nearest first throughout: a photo does not move a café up.
  assert.deepEqual(merged.map((entry) => entry.detourMinutes), [...merged.map((entry) => entry.detourMinutes)].sort((x, y) => x - y));
  // A different café next door is not mistaken for the same one.
  assert.equal(withListedCafes([pick("喫茶 みどり", 35.0030, 6)], brk, [listed("d", "ドトール", 35.00301, "https://imgfp.hotp.jp/d.jpg")]).length, 2);
});

test("two cafés in one block are not one café because their names begin alike", async () => {
  const { withListedCafes } = await import("../lib/shiori/cafes.ts");
  const from = { latitude: 35.0000, longitude: 135.0000 };
  const brk = { afterStop: 0, time: "15:00", reason: "after" as const, from, fromName: "寺", to: null, toName: null, search: from };
  const pick = (name: string) => ({ id: `apple-${name}`, name, address: "", latitude: 35.001, longitude: 135, kind: "cafe" as const, detourMinutes: 2, mapsUrl: "https://example.test" });
  // 0.00045° of latitude is 50 m: inside the distance at which names are compared.
  const listed = (name: string) => ({ id: "x", name, latitude: 35.00145, longitude: 135, address: null, budget: "1001～1500円", photo: "https://imgfp.hotp.jp/x.jpg", url: null });
  const apart: Array<[string, string]> = [
    ["Cafe Aoi", "Cafe Midori"],
    ["カフェ・ド・クリエ 寺前店", "カフェ ド 巴里"],
    ["Coffee House Ren", "Coffee Stand Kai"],
    ["Cafe", "Cafe Midori"],
    // Two branches of one chain, fifty metres apart.
    ["タリーズコーヒー 寺前北口店", "タリーズコーヒー 寺前南口店"],
  ];
  for (const [onMap, inGuide] of apart) {
    const merged = withListedCafes([pick(onMap)], brk, [listed(inGuide)]);
    assert.deepEqual(merged.map((entry) => entry.name), [onMap, inGuide], `${onMap} / ${inGuide}`);
    // The other shop's photo and budget stay with the other shop.
    assert.equal(merged[0].photo, undefined, onMap);
    assert.equal(merged[0].budget, undefined, onMap);
  }
  const same: Array<[string, string]> = [
    ["スターバックス コーヒー 寺前店", "スターバックスコーヒー 寺前店"],
    ["スターバックス", "スターバックス コーヒー 寺前店"],
    ["コメダ珈琲店 寺前店", "コメダ珈琲 寺前"],
  ];
  for (const [onMap, inGuide] of same) {
    const merged = withListedCafes([pick(onMap)], brk, [listed(inGuide)]);
    assert.equal(merged.length, 1, `${onMap} / ${inGuide}`);
    assert.equal(merged[0].photo, "https://imgfp.hotp.jp/x.jpg");
  }
});
