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

test("server-renders the map-first TripCheck planner", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TripCheck — Japan trip planner<\/title>/i);
  assert.match(html, /Where do you want to go\?/);
  assert.match(html, /Put it on the map/);
  assert.match(html, /Try a sample/);
  assert.match(html, /Your trip will appear here/);
  assert.match(html, /Google Maps/);
  assert.match(html, /Itinerary on Google Maps/);
  assert.match(html, /Hotel or preferred area/);
  assert.match(html, /FAQPage/);
  assert.match(html, /SoftwareApplication/);
  assert.doesNotMatch(html, /SCROLL TO PLAY|Get the whole trip\.|One plan instead of six tabs/i);
  assert.match(html, />EN</);
  assert.match(html, /日本語/);
  assert.doesNotMatch(html, /<option[^>]*value="ko"/i);
  assert.doesNotMatch(html, /<option[^>]*value="zh"/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});
