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
  // A visible optional country bias prevents localized same-name businesses
  // from being silently chosen before auto-detection has enough evidence.
  assert.match(html, /id="planner-destination"/);
  assert.match(html, /choose it first to disambiguate same-named cities and venues/i);
  assert.match(html, /class="trip-planner-app is-places"/);
  // v1.1 Start: two decisions (places + days), automatic mode by default.
  assert.match(html, /Just choose the places\./);
  assert.match(html, /Build my trip/);
  assert.match(html, /How many days\?/);
  assert.match(html, /Not decided/);
  assert.match(html, /Set hotel, airport or pace/);
  assert.doesNotMatch(html, /Build it for me|Fine-tune it/);
  assert.match(html, /One place per line\. Pause to see matches, then choose one to avoid same-name mix-ups\./);
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
  // TC-018: the bare "/" honors the device's stored language before paint —
  // the inline gate must run ahead of hydration, whose locale effect would
  // otherwise overwrite the stored key with "en".
  assert.match(html, /localStorage\.getItem\("tripcheck-locale"\)==="ja"/);
  assert.match(html, /location\.replace\("\/ja"\+location\.search\+location\.hash\)/);
  assert.match(html, /<a(?=[^>]*class="planner-privacy")(?=[^>]*href="\/privacy")[^>]*>/i);
  assert.doesNotMatch(html, /<option[^>]*value="ko"/i);
  assert.doesNotMatch(html, /<option[^>]*value="zh"/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
  assert.match(html, /og-feasibility\.png/);
});

/* The planner surface is split across TripPlannerApp, extracted planner
 * components and the lib presentation layer (refactor spec v2.1). Contract
 * checks must hold wherever the code lives, so they scan all of it. */
async function plannerSurfaceSources() {
  const { readdir } = await import("node:fs/promises");
  const roots = [
    { url: new URL("../app/", import.meta.url), filter: /\.tsx$/ },
    { url: new URL("../lib/presentation/", import.meta.url), filter: /\.ts$/ },
  ];
  const sources = [{
    path: "lib/planner-app-state.ts",
    text: await readFile(new URL("../lib/planner-app-state.ts", import.meta.url), "utf8"),
  }];
  for (const root of roots) {
    const entries = await readdir(root.url, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !root.filter.test(entry.name)) continue;
      const fileUrl = new URL(`${entry.parentPath.replace(/\/?$/, "/")}${entry.name}`, "file://");
      sources.push({ path: fileUrl.pathname, text: await readFile(fileUrl, "utf8") });
    }
  }
  return sources;
}

test("keeps P0 trust, print and adoption contracts explicit in the planner UI", async () => {
  const sources = await plannerSurfaceSources();
  const all = sources.map((entry) => entry.text).join("\n");
  const css = await readFile(new URL("../app/planner.css", import.meta.url), "utf8");

  assert.match(all, /\{printMode && plan \? \(/);
  const printFile = sources.find((entry) => entry.text.includes('className="planner-print-sheet"'));
  assert.ok(printFile, "print sheet JSX exists somewhere in the planner surface");
  const printStart = printFile.text.indexOf('className="planner-print-sheet"');
  const printEnd = printFile.text.indexOf('<header className="planner-topbar">', printStart);
  const printSource = printFile.text.slice(printStart, printEnd > printStart ? printEnd : undefined);
  assert.match(printSource, /plan\.unknownEntries/);
  assert.match(printSource, /plan\.deferredUnavailableStops/);
  assert.match(printSource, /plan\.deferredOptionalStops/);
  assert.match(printSource, /removedStops/);
  assert.match(printSource, /maxTransfersPerLeg/);
  assert.match(printSource, /printTransferCopy/);
  assert.match(all, /function printTransferCopy[\s\S]*leg\.transferCount/);
  assert.match(printSource, /!P0_CORE_ONLY && activeEssentials/);

  const autoSaveFile = sources.find((entry) => entry.text.includes("// Save meaningful user-authored changes"));
  assert.ok(autoSaveFile, "autosave effect exists somewhere in the planner surface");
  const autoSaveStart = autoSaveFile.text.indexOf("// Save meaningful user-authored changes");
  const autoSaveEnd = autoSaveFile.text.indexOf("const currentHotelPlanSignature", autoSaveStart);
  const autoSaveSource = autoSaveFile.text.slice(autoSaveStart, autoSaveEnd > autoSaveStart ? autoSaveEnd : undefined);
  assert.doesNotMatch(autoSaveSource, /plan_saved_or_shared/);

  assert.match(all, /planner-one-warning/);
  assert.match(all, /planner-verdict-details/);
  assert.match(all, /<PlannerDayTimeBar/);
  assert.doesNotMatch(all, /className="is-checked"><Icon name="check"/);
  assert.match(all, /planner-verdict-label/);
  assert.match(all, /feasibilityStateIcon\(feasibilityResult\.state\)/);
  assert.match(css, /planner-stop-flags \.is-unknown/);
  assert.match(css, /planner-privacy > span \{ display: none; \}/);
});
