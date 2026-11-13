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
