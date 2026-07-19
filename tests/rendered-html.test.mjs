import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the TripCheck landing experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Tokyo Trip Builder &amp; Route Optimizer \| TripCheck Japan<\/title>/i);
  assert.match(html, /Get the whole trip\./);
  assert.match(html, /Build my best route/);
  assert.match(html, /Run the full trip demo/);
  assert.match(html, /One input\./);
  assert.match(html, /The whole trip fits around it\./);
  assert.match(html, /One plan instead of six tabs/);
  assert.match(html, /Hotel or nearest station/);
  assert.match(html, /FAQPage/);
  assert.match(html, /SoftwareApplication/);
  assert.match(html, /How is it different from ChatGPT or Google Maps\?/);
  assert.match(html, /Who can see the itinerary I paste\?/);
  assert.match(html, /Live transit sends only coordinate pairs and departure times/i);
  assert.match(html, /Optional live Google Maps public-transit times/i);
  assert.doesNotMatch(html, /founding-review|human-assisted itinerary|Checkout opening soon/i);
  assert.match(html, /English/);
  assert.match(html, /日本語/);
  assert.doesNotMatch(html, /<option[^>]*value="ko"/i);
  assert.doesNotMatch(html, /<option[^>]*value="zh"/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});
