/**
 * QA-054 / TC-066: visual-regression harness for the five key surfaces.
 * Coverage: {start, resolve, plan, detail} × {ja, en} × {1440×900, 768×1024,
 * 390×844} — the 390px column is the "Mobile" screen of the spec matrix, and
 * `detail` at 390px captures the bottom-sheet inspector.
 *
 *   QA_MODULES=… node tools/qa/run-vr.mjs --update   # (re)write baselines
 *   QA_MODULES=… node tools/qa/run-vr.mjs            # compare against them
 *
 * Baselines live in tests/vr/baselines/. Runs are deterministic: external
 * hosts are blocked (the map shows its offline panel), the clock is frozen,
 * animations and carets are disabled, and every page uses a fresh browser
 * context so device-stored trips never leak into a shot. Diff images for
 * failures land in tools/qa/vr-out/.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ambiguityFixture,
  ambiguityInput,
  buildSamplePlan,
  clickStartCtaUntil,
  gotoStart,
  launchBrowser,
  newPage,
  qaRequire,
  setWishlist,
  settle,
} from "./qa-lib.mjs";

const pixelmatch = qaRequire("pixelmatch");
const { PNG } = qaRequire("pngjs");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baselineDir = join(repoRoot, "tests", "vr", "baselines");
const outDir = join(repoRoot, "tools", "qa", "vr-out");
const update = process.argv.includes("--update");
const only = process.argv.find((argument) => argument.startsWith("--only="))?.slice(7) ?? null;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];
const LOCALES = ["ja", "en"];
const ALLOWED_DIFF_RATIO = 0.003; // 0.3% of pixels absorbs antialiasing noise

const FROZEN_MS = Date.UTC(2026, 7, 11, 0, 0, 0); // 2026-08-11T09:00 JST

async function freezeAndCalm(page) {
  await page.evaluateOnNewDocument((frozenMs) => {
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(frozenMs);
        else super(...args);
      }

      static now() {
        return frozenMs;
      }
    }
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    // eslint-disable-next-line no-global-assign
    window.Date = FrozenDate;
  }, FROZEN_MS);
}

async function calmStyles(page) {
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
  await page.evaluate(() => document.fonts?.ready ?? null);
  await settleMapSurface(page);
  await settle(page, 400);
}

/*
 * External hosts are blocked in this harness, so the Google Maps script always
 * fails - but *when* it fails is a race against the settle window. A cold run
 * once photographed the map pane mid-"loading" and a warm run photographed the
 * resolved offline panel, from identical code. Waiting for the surface to
 * reach a terminal state makes the shot a property of the build rather than of
 * the machine's mood.
 */
async function settleMapSurface(page) {
  const hasMapSurface = await page.$(".planner-map-canvas, .planner-google-map, .planner-map-provider-unavailable");
  if (!hasMapSurface) return;
  await page.waitForFunction(
    () => document.querySelector(".planner-google-map.is-visible") !== null
      || document.querySelector(".planner-map-provider-unavailable") !== null,
    { timeout: 20_000 },
  ).catch(() => {});
}

const SCREENS = {
  start: async (page, locale) => {
    await gotoStart(page, locale);
  },
  resolve: async (page, locale) => {
    await gotoStart(page, locale);
    await setWishlist(page, ambiguityInput(locale));
    await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });
  },
  plan: async (page, locale) => {
    await buildSamplePlan(page, locale);
  },
  detail: async (page, locale) => {
    await buildSamplePlan(page, locale);
    await page.click(".planner-stop-row");
    await page.waitForSelector(".planner-inspector", { timeout: 10_000 });
  },
};

function shotName(screen, locale, viewport) {
  return `${screen}-${locale}-${viewport.width}.png`;
}

mkdirSync(baselineDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const browser = await launchBrowser();
let failures = 0;
let captured = 0;
try {
  for (const [screen, prepare] of Object.entries(SCREENS)) {
    if (only && screen !== only) continue;
    for (const locale of LOCALES) {
      for (const viewport of VIEWPORTS) {
        const name = shotName(screen, locale, viewport);
        const page = await newPage(browser, {
          width: viewport.width,
          height: viewport.height,
          isolated: true,
          // The resolve fixture is served locally; every other paid call is
          // refused so the shot is a property of the build, not of the day's
          // provider answers or remaining budget.
          offlineProviders: true,
          fixtures: screen === "resolve" ? { placeResolution: ambiguityFixture(locale) } : {},
        });
        try {
          await freezeAndCalm(page);
          await prepare(page, locale);
          await calmStyles(page);
          const shot = await page.screenshot({ type: "png" });
          captured += 1;
          const baselinePath = join(baselineDir, name);
          if (update || !existsSync(baselinePath)) {
            writeFileSync(baselinePath, shot);
            console.log(`BASE  ${name}`);
          } else {
            const baseline = PNG.sync.read(readFileSync(baselinePath));
            const current = PNG.sync.read(shot);
            if (baseline.width !== current.width || baseline.height !== current.height) {
              failures += 1;
              writeFileSync(join(outDir, name), shot);
              console.log(`FAIL  ${name} — size ${current.width}×${current.height} vs baseline ${baseline.width}×${baseline.height}`);
            } else {
              const diff = new PNG({ width: baseline.width, height: baseline.height });
              const diffPixels = pixelmatch(baseline.data, current.data, diff.data, baseline.width, baseline.height, { threshold: 0.12 });
              const ratio = diffPixels / (baseline.width * baseline.height);
              if (ratio > ALLOWED_DIFF_RATIO) {
                failures += 1;
                writeFileSync(join(outDir, name), shot);
                writeFileSync(join(outDir, name.replace(/\.png$/, ".diff.png")), PNG.sync.write(diff));
                console.log(`FAIL  ${name} — ${(ratio * 100).toFixed(2)}% pixels differ`);
              } else {
                console.log(`PASS  ${name}${diffPixels > 0 ? ` (${(ratio * 100).toFixed(3)}% noise)` : ""}`);
              }
            }
          }
        } catch (error) {
          failures += 1;
          console.log(`FAIL  ${name} — ${error?.message ?? error}`);
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${captured} shots, ${failures} failure(s)${update ? " (baselines updated)" : ""}`);
if (failures > 0) process.exitCode = 1;
