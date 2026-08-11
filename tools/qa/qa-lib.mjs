/**
 * Shared launcher and page helpers for the TripCheck QA harness
 * (tools/qa/run-e2e.mjs, run-axe.mjs, run-vr.mjs).
 *
 * The harness dependencies are deliberately NOT in package.json: the repo is
 * installed with pnpm and its lockfile must not drift for QA-only tooling.
 * Install them in any scratch directory and point QA_MODULES at it:
 *
 *   mkdir -p ~/tripcheck-qa && cd ~/tripcheck-qa \
 *     && npm i puppeteer-core@24 pixelmatch@5 pngjs@7 axe-core@4
 *   QA_MODULES=~/tripcheck-qa/node_modules node tools/qa/run-e2e.mjs
 *
 * The harness drives the locally installed Chrome (QA_CHROME to override) in
 * headless mode against BASE_URL (default http://127.0.0.1:8788). All
 * non-BASE_URL network requests are aborted so runs stay deterministic and
 * provider-free; /api/place-resolution can be answered with a fixture.
 */
import { createRequire } from "node:module";
import { join } from "node:path";

const moduleRoots = [
  process.env.QA_MODULES,
  process.env.QA_MODULES ? join(process.env.QA_MODULES, "node_modules") : null,
  join(process.cwd(), "node_modules"),
].filter(Boolean);

export function qaRequire(name) {
  for (const root of moduleRoots) {
    try {
      return createRequire(join(root, "qa-anchor.js"))(name);
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error(`QA dependency "${name}" not found. Set QA_MODULES to a node_modules with it (see tools/qa/README.md).`);
}

export function qaResolve(name) {
  for (const root of moduleRoots) {
    try {
      return createRequire(join(root, "qa-anchor.js")).resolve(name);
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error(`QA dependency "${name}" not found. Set QA_MODULES to a node_modules with it (see tools/qa/README.md).`);
}

export const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const CHROME = process.env.QA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launchBrowser() {
  const puppeteer = qaRequire("puppeteer-core");
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-first-run",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--force-color-profile=srgb",
      "--disable-features=Translate,AcceptCHFrame",
      "--lang=ja",
    ],
  });
}

/**
 * New page with external traffic blocked. `fixtures.placeResolution` answers
 * POST /api/place-resolution so the Resolve step is testable without any
 * provider key or quota. `fixtures.foodRecommendations` answers POST
 * /api/food-recommendations the same way (a function fixture receives the
 * parsed request payload, so candidates can sit at the slot's coordinates).
 * `isolated: true` gives the page its own browser context — no shared
 * localStorage, so "recent trips" from another scenario can never leak into
 * a screenshot.
 */
export async function newPage(browser, { width = 1440, height = 900, fixtures = {}, isolated = false } = {}) {
  const context = isolated ? await browser.createBrowserContext() : browser;
  const page = await context.newPage();
  if (isolated) {
    const originalClose = page.close.bind(page);
    page.close = async (...args) => {
      await originalClose(...args);
      await context.close().catch(() => {});
    };
  }
  await page.setViewport({ width, height });
  await page.emulateTimezone("Asia/Tokyo");
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (fixtures.placeResolution && url.startsWith(`${BASE_URL}/api/place-resolution`) && request.method() === "POST") {
      request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixtures.placeResolution),
      }).catch(() => {});
      return;
    }
    if (fixtures.foodRecommendations && url === `${BASE_URL}/api/food-recommendations` && request.method() === "POST") {
      let payload = {};
      try { payload = JSON.parse(request.postData() ?? "{}"); } catch { /* keep {} */ }
      const body = typeof fixtures.foodRecommendations === "function"
        ? fixtures.foodRecommendations(payload)
        : fixtures.foodRecommendations;
      request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      }).catch(() => {});
      return;
    }
    if (url.startsWith(BASE_URL) || url.startsWith("data:") || url.startsWith("blob:")) {
      request.continue().catch(() => {});
      return;
    }
    request.abort().catch(() => {});
  });
  return page;
}

export function localePath(locale) {
  return locale === "ja" ? "/ja" : "/";
}

export async function gotoStart(page, locale) {
  // TC-018: the bare "/" honors the device's stored language. Pin the stored
  // locale to the one under test so an earlier ja scenario in the same shared
  // profile cannot redirect the en start page away from "/".
  await page.evaluateOnNewDocument((value) => {
    try { window.localStorage.setItem("tripcheck-locale", value); } catch { /* optional */ }
  }, locale === "ja" ? "ja" : "en");
  await page.goto(`${BASE_URL}${localePath(locale)}`, { waitUntil: "networkidle2", timeout: 45_000 });
  await page.waitForSelector(".planner-review-button", { timeout: 20_000 });
}

/** Set the wishlist textarea through React's native value setter. */
export async function setWishlist(page, text) {
  await page.waitForSelector(".trip-planner-app textarea", { timeout: 20_000 });
  await page.evaluate((value) => {
    const textarea = document.querySelector(".trip-planner-app textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

/**
 * Clicks the Start CTA until `expectSelector` appears. Hydration makes the
 * first click a possible no-op, so a bounded retry is part of the contract.
 */
export async function clickStartCtaUntil(page, expectSelector, { attempts = 5, timeout = 3_000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.click(".planner-review-button").catch(() => {});
    try {
      await page.waitForSelector(expectSelector, { timeout });
      return;
    } catch {
      // retry
    }
  }
  throw new Error(`"${expectSelector}" did not appear after ${attempts} CTA clicks`);
}

export async function clickByText(page, selector, text) {
  const clicked = await page.evaluate(({ selector: sel, text: needle }) => {
    const nodes = [...document.querySelectorAll(sel)];
    const target = nodes.find((node) => (node.textContent ?? "").includes(needle));
    if (!target) return false;
    target.click();
    return true;
  }, { selector, text });
  if (!clicked) throw new Error(`No "${selector}" containing "${text}"`);
}

export async function waitForText(page, selector, text, { timeout = 15_000 } = {}) {
  await page.waitForFunction(({ selector: sel, text: needle }) => (
    [...document.querySelectorAll(sel)].some((node) => (node.textContent ?? "").includes(needle))
  ), { timeout }, { selector, text });
}

/** Builds the bundled sample trip (no providers involved) and waits for the plan. */
export async function buildSamplePlan(page, locale) {
  await gotoStart(page, locale);
  await page.waitForSelector(".planner-sample-link", { timeout: 20_000 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.click(".planner-sample-link").catch(() => {});
    try {
      await page.waitForSelector(".trip-planner-app.is-result", { timeout: 4_000 });
      break;
    } catch {
      // hydration retry
    }
  }
  await page.waitForSelector(".trip-planner-app.is-result", { timeout: 30_000 });
  await page.waitForSelector(".planner-day-tabs button", { timeout: 30_000 });
  await settle(page, 500);
}

export async function settle(page, ms = 300) {
  await page.evaluate((delay) => new Promise((resolveDelay) => setTimeout(resolveDelay, delay)), ms);
}

function fixtureStop(inputIndex, input, overrides = {}) {
  return {
    id: overrides.id ?? `fixture-${inputIndex}-${input}`,
    input,
    inputIndex,
    name: overrides.name ?? input,
    area: overrides.area ?? "Luzern",
    address: overrides.address ?? "6003 Luzern, Switzerland",
    latitude: overrides.latitude ?? 47.0517,
    longitude: overrides.longitude ?? 8.3059,
    sourceUrl: "",
    verifiedAt: "2026-08-11T00:00:00.000Z",
    confidence: "medium",
    planningDurationMinutes: 60,
    isAnchor: false,
    countryCode: overrides.countryCode ?? "CH",
    providerRef: overrides.providerRef ?? `ref-${inputIndex}-${(overrides.name ?? input).replace(/\W+/g, "")}`,
    ...overrides,
  };
}

/**
 * QA-008/009 fixture: place 0 resolves cleanly, place 1 is ambiguous with two
 * candidates, place 2 does not resolve at all.
 */
export function ambiguityFixture(locale) {
  const ja = locale === "ja";
  return {
    provider: "google_maps",
    fetchedAt: "2026-08-11T00:00:00.000Z",
    hotel: null,
    places: [
      fixtureStop(0, ja ? "カペル橋" : "Chapel Bridge", { name: ja ? "カペル橋" : "Chapel Bridge" }),
    ],
    ambiguous: [
      {
        input: ja ? "リギ山" : "Mount Rigi",
        candidates: [
          fixtureStop(1, ja ? "リギ山" : "Mount Rigi", {
            id: "fixture-rigi-kulm",
            name: ja ? "リギ・クルム（山頂）" : "Rigi Kulm (summit)",
            area: "Arth",
            address: "6410 Arth, Switzerland",
            latitude: 47.0567,
            longitude: 8.4854,
            providerRef: "ref-rigi-kulm",
          }),
          fixtureStop(1, ja ? "リギ山" : "Mount Rigi", {
            id: "fixture-rigi-kaltbad",
            name: ja ? "リギ・カルトバート" : "Rigi Kaltbad",
            area: "Weggis",
            address: "6356 Weggis, Switzerland",
            latitude: 47.0428,
            longitude: 8.4667,
            providerRef: "ref-rigi-kaltbad",
          }),
        ],
      },
    ],
  };
}

/** Fixture where a must-marked place resolves to nothing (§5.2 hard confirm). */
export function unresolvedMustFixture(locale) {
  const ja = locale === "ja";
  return {
    provider: "google_maps",
    fetchedAt: "2026-08-11T00:00:00.000Z",
    hotel: null,
    places: [
      fixtureStop(0, ja ? "カペル橋" : "Chapel Bridge", { name: ja ? "カペル橋" : "Chapel Bridge" }),
    ],
    ambiguous: [],
  };
}

export function ambiguityInput(locale) {
  return locale === "ja"
    ? "カペル橋\nリギ山\n謎の食堂ゾルバ"
    : "Chapel Bridge\nMount Rigi\nZorba's hidden diner";
}

export function unresolvedMustInput(locale) {
  return locale === "ja"
    ? "カペル橋\nリギ山 必須"
    : "Chapel Bridge\nMount Rigi must";
}

/**
 * /api/food-recommendations fixture: two well-reviewed, planned-open
 * candidates a ~100m walk from whatever slot coordinates the app asked
 * about, so the sample plan grows real meal-recommendation rows (with the
 * ここにする accept button) without any provider key. Pass the returned
 * function as `fixtures.foodRecommendations`.
 */
export function foodRecommendationsFixture(locale) {
  const ja = locale === "ja";
  return (payload) => {
    const latitude = typeof payload.latitude === "number" ? payload.latitude : 47.0517;
    const longitude = typeof payload.longitude === "number" ? payload.longitude : 8.3059;
    const kind = payload.mealKind === "dinner" ? "dinner" : "lunch";
    const candidate = (index, name) => ({
      id: `qa-food-${kind}-${latitude.toFixed(3)}-${index}`,
      name,
      address: ja ? "スイス ルツェルン 6003" : "6003 Luzern, Switzerland",
      type: ja ? "レストラン" : "Restaurant",
      googleMapsUrl: `${BASE_URL}/#qa-food-${index}`,
      latitude: latitude + 0.0009,
      longitude: longitude + 0.0004 * (index + 1),
      distanceMeters: 110 + index * 40,
      rating: 4.4 - index * 0.2,
      userRatingCount: 320 - index * 60,
      openNow: true,
      plannedOpen: true,
      hours: [],
      businessStatus: "OPERATIONAL",
      paymentEvidence: [],
      reviewSnippets: [],
      websiteUrl: null,
    });
    return {
      provider: "google_maps",
      ranking: "evidence_weighted",
      fetchedAt: "2026-08-11T00:00:00.000Z",
      candidates: kind === "lunch"
        ? [candidate(0, ja ? "湖畔食堂アルペン" : "Alpen Lakeside Kitchen"), candidate(1, ja ? "旧市街ビストロ" : "Old Town Bistro")]
        : [candidate(0, ja ? "夕暮れ食堂リギ" : "Rigi Sunset Table"), candidate(1, ja ? "橋前レストラン" : "Bridge House Restaurant")],
    };
  };
}

/**
 * Presses Tab (or Shift+Tab) until the in-page predicate — evaluated against
 * document.activeElement after every keystroke — returns true. Keyboard-only
 * by construction: no mouse, tap or programmatic .focus() involved. Returns
 * the number of presses used; throws after `max` presses.
 */
export async function pressTabUntil(page, predicate, { max = 60, shift = false, label = "target" } = {}) {
  for (let press = 1; press <= max; press += 1) {
    if (shift) await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    if (shift) await page.keyboard.up("Shift");
    if (await page.evaluate(predicate)) return press;
  }
  throw new Error(`${label} not reached after ${max} ${shift ? "Shift+Tab" : "Tab"} presses`);
}

/**
 * DoD-A11Y-2: the focused control must carry a visible focus indicator.
 * Keyboard focus makes :focus-visible match, so the app-wide rule
 * (planner.css: 3px solid outline) — or any box-shadow indicator — must be
 * computable on document.activeElement. Throws when the indicator is absent.
 */
export async function assertVisibleFocus(page, label) {
  const state = await page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return { tag: active?.tagName ?? "none", visible: false };
    const style = getComputedStyle(active);
    const outlineVisible = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    const shadowVisible = style.boxShadow !== "none" && style.boxShadow !== "";
    return {
      tag: `${active.tagName.toLowerCase()}.${[...active.classList].join(".")}`,
      visible: outlineVisible || shadowVisible,
    };
  });
  if (!state.visible) throw new Error(`${label}: focused ${state.tag} has no visible focus indicator`);
}
