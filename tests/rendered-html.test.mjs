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

test("server-renders the input-first TripCheck itinerary builder", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TripCheck — build a realistic itinerary from saved places<\/title>/i);
  // v1.1 TC-012: the country never greets the traveller. Detection is
  // automatic; the picker only exists behind the advanced disclosure.
  assert.doesNotMatch(html, /id="planner-destination"/);
  assert.match(html, /class="trip-planner-app is-places"/);
  // v1.1 Start: two decisions (places + days), automatic mode by default.
  assert.match(html, /Just choose the places\./);
  assert.match(html, /Build my trip/);
  assert.match(html, /How many days\?/);
  assert.match(html, /Not decided/);
  assert.match(html, /Set hotel, airport or pace/);
  assert.doesNotMatch(html, /Build it for me|Fine-tune it/);
  assert.match(html, /One place per line\. Any order is fine\./);
  assert.match(html, /Places &amp; days/);
  assert.match(html, />Itinerary</);
  assert.doesNotMatch(html, />Conditions</);
  assert.match(html, /See a finished example/);
  assert.match(html, /This works comfortably in 4 days/);
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
  assert.match(source, /planner-one-warning/);
  assert.match(source, /planner-verdict-details/);
  assert.match(source, /<PlannerDayTimeBar/);
  assert.doesNotMatch(source, /className="is-checked"><Icon name="check"/);
  assert.match(source, /planner-verdict-label/);
  assert.match(source, /feasibilityStateIcon\(feasibilityResult\.state\)/);
  assert.match(css, /planner-stop-flags \.is-unknown/);
  assert.match(css, /planner-privacy > span \{ display: none; \}/);
});
