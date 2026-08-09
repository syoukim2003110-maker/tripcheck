import assert from "node:assert/strict";
import test from "node:test";
import { fetchJpyRate, parseFxBase } from "../lib/fx-rates.ts";

test("parseFxBase accepts ISO codes and rejects JPY itself", () => {
  assert.equal(parseFxBase("CHF"), "CHF");
  assert.equal(parseFxBase("JPY"), null);
  assert.equal(parseFxBase("chf"), null);
  assert.equal(parseFxBase("CHFX"), null);
  assert.equal(parseFxBase(null), null);
});

test("fetchJpyRate prefers Frankfurter", async () => {
  const fetcher = (async (url: RequestInfo | URL) => {
    assert.match(String(url), /frankfurter\.dev/);
    return Response.json({ amount: 1, base: "CHF", date: "2026-08-07", rates: { JPY: 195.4 } });
  }) as typeof fetch;
  assert.deepEqual(await fetchJpyRate("CHF", fetcher), {
    base: "CHF",
    jpyPerUnit: 195.4,
    asOf: "2026-08-07",
    source: "frankfurter",
  });
});

test("fetchJpyRate falls back to open.er-api when Frankfurter fails", async () => {
  const fetcher = (async (url: RequestInfo | URL) => {
    if (String(url).includes("frankfurter")) return new Response("", { status: 500 });
    return Response.json({
      result: "success",
      time_last_update_utc: "Fri, 07 Aug 2026 00:02:31 +0000",
      rates: { JPY: 194.9 },
    });
  }) as typeof fetch;
  const rate = await fetchJpyRate("CHF", fetcher);
  assert.equal(rate.source, "open-er-api");
  assert.equal(rate.jpyPerUnit, 194.9);
  assert.equal(rate.asOf, "2026-08-07");
});

test("fetchJpyRate rejects nonsense rates and throws when both providers fail", async () => {
  const zeroRate = (async (url: RequestInfo | URL) => String(url).includes("frankfurter")
    ? Response.json({ base: "CHF", date: "2026-08-07", rates: { JPY: 0 } })
    : Response.json({ result: "success", rates: { JPY: -3 } })) as typeof fetch;
  await assert.rejects(() => fetchJpyRate("CHF", zeroRate), /fx_unavailable/);

  const down = (async () => { throw new Error("offline"); }) as typeof fetch;
  await assert.rejects(() => fetchJpyRate("CHF", down), /fx_unavailable/);
});
