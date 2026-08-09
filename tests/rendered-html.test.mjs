import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("server-renders the input-first TripCheck feasibility checker", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TripCheck — itinerary feasibility checker<\/title>/i);
  // The searchable country picker ships in the server-rendered form,
  // defaulting to detection rather than to any one country.
  assert.match(html, /Detect automatically/);
  assert.match(html, /<input(?=[^>]*id="planner-destination")(?=[^>]*role="combobox")(?=[^>]*value="Detect automatically")[^>]*>/i);
  assert.match(html, /Type a country to choose/);
  assert.match(html, /class="trip-planner-app is-places"/);
  assert.match(html, /Paste your saved places\./);
  assert.match(html, /See what actually fits/);
  assert.match(html, />Places</);
  assert.match(html, />Conditions</);
  assert.match(html, />Result</);
  assert.match(html, /Check these places/);
  assert.match(html, /Try a sample/);
  // Step 1 is intentionally map-free: hiding the canvas in CSS would still
  // load Google and spend privacy/cost budget before the traveller asks.
  assert.doesNotMatch(html, /Itinerary on Google Maps|maps\.googleapis\.com\/maps\/api\/js/);
  assert.doesNotMatch(html, /Where do you want to go\?|Put it on the map/);
  assert.doesNotMatch(html, /Hotel or preferred area/);
  assert.match(html, /FAQPage/);
  assert.match(html, /SoftwareApplication/);
  assert.doesNotMatch(html, /SCROLL TO PLAY|Get the whole trip\.|One plan instead of six tabs/i);
  assert.match(html, />EN</);
  assert.match(html, /日本語/);
  assert.match(html, /<a(?=[^>]*class="planner-privacy")(?=[^>]*href="\/privacy")[^>]*>/i);
  assert.doesNotMatch(html, /<option[^>]*value="ko"/i);
  assert.doesNotMatch(html, /<option[^>]*value="zh"/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
  assert.match(html, /og-feasibility\.png/);
});

test("keeps P0 trust, print and adoption contracts explicit in the planner UI", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/TripPlannerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/planner.css", import.meta.url), "utf8"),
  ]);
  const printStart = source.indexOf("{printMode && plan ? (");
  const printEnd = source.indexOf('<header className="planner-topbar">', printStart);
  const printSource = source.slice(printStart, printEnd);
  const autoSaveStart = source.indexOf("// Save meaningful user-authored changes");
  const autoSaveEnd = source.indexOf("const currentHotelPlanSignature", autoSaveStart);
  const autoSaveSource = source.slice(autoSaveStart, autoSaveEnd);

  assert.ok(printStart >= 0 && printEnd > printStart);
  assert.match(printSource, /plan\.unknownEntries/);
  assert.match(printSource, /plan\.deferredUnavailableStops/);
  assert.match(printSource, /plan\.deferredOptionalStops/);
  assert.match(printSource, /removedStops/);
  assert.match(printSource, /maxTransfersPerLeg/);
  assert.match(printSource, /printTransferCopy/);
  assert.match(source, /function printTransferCopy[\s\S]*leg\.transferCount/);
  assert.match(printSource, /!P0_CORE_ONLY && activeEssentials/);
  assert.doesNotMatch(autoSaveSource, /plan_saved_or_shared/);
  assert.match(source, /builtStop\.openingStatus === "unknown" \? <i className="is-unknown">/);
  assert.doesNotMatch(source, /builtStop\.openingStatus === "unknown" && stopIntel/);
  assert.match(source, /planner-verdict-label/);
  assert.match(source, /feasibilityStateIcon\(feasibilityResult\.state\)/);
  assert.match(css, /planner-stop-flags \.is-unknown/);
  assert.match(css, /planner-privacy > span \{ display: none; \}/);
});
