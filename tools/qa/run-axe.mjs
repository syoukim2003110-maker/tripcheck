/**
 * QA-046 / TC-057: automated axe-core WCAG 2.2 AA scan over the five key
 * surfaces (Start, Resolve, Plan, Detail inspector, must-confirm dialog).
 *
 *   QA_MODULES=…/node_modules node tools/qa/run-axe.mjs
 *
 * Any violation in the wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa tag set fails
 * the run (exit 1). "Incomplete" findings are listed for manual review but do
 * not fail; they are axe's "cannot decide automatically" bucket.
 */
import { readFileSync } from "node:fs";
import {
  ambiguityFixture,
  ambiguityInput,
  buildSamplePlan,
  clickByText,
  clickStartCtaUntil,
  gotoStart,
  launchBrowser,
  newPage,
  qaResolve,
  setWishlist,
  settle,
  unresolvedMustFixture,
  unresolvedMustInput,
} from "./qa-lib.mjs";

const axeSource = readFileSync(qaResolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page, label) {
  await page.evaluate(axeSource);
  const result = await page.evaluate(async (tags) => {
    const outcome = await window.axe.run(document, {
      runOnly: { type: "tag", values: tags },
      resultTypes: ["violations", "incomplete"],
    });
    const compact = (entries) => entries.map((entry) => ({
      id: entry.id,
      impact: entry.impact,
      help: entry.help,
      nodes: entry.nodes.slice(0, 5).map((node) => node.target.join(" ")),
      nodeCount: entry.nodes.length,
    }));
    return { violations: compact(outcome.violations), incomplete: compact(outcome.incomplete) };
  }, TAGS);
  for (const violation of result.violations) {
    console.log(`FAIL  ${label}  ${violation.id} (${violation.impact}) ×${violation.nodeCount} — ${violation.help}`);
    for (const target of violation.nodes) console.log(`        ${target}`);
  }
  for (const incomplete of result.incomplete) {
    console.log(`note  ${label}  needs manual review: ${incomplete.id} ×${incomplete.nodeCount} — ${incomplete.nodes.join(" | ")}`);
  }
  if (result.violations.length === 0) console.log(`PASS  ${label}`);
  return result.violations.length;
}

const browser = await launchBrowser();
let violationCount = 0;
try {
  for (const locale of ["ja", "en"]) {
    const page = await newPage(browser);
    await gotoStart(page, locale);
    await settle(page, 400);
    violationCount += await scan(page, `start-${locale}`);
    await page.close();
  }

  {
    const page = await newPage(browser, { fixtures: { placeResolution: ambiguityFixture("ja") } });
    await gotoStart(page, "ja");
    await setWishlist(page, ambiguityInput("ja"));
    await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });
    await settle(page, 300);
    violationCount += await scan(page, "resolve-ja");
    await page.close();
  }

  {
    const page = await newPage(browser);
    await buildSamplePlan(page, "ja");
    violationCount += await scan(page, "plan-ja");
    await page.click(".planner-stop-row");
    await page.waitForSelector(".planner-inspector", { timeout: 10_000 });
    await settle(page, 300);
    violationCount += await scan(page, "detail-ja");
    await page.close();
  }

  {
    const page = await newPage(browser, { fixtures: { placeResolution: unresolvedMustFixture("ja") } });
    await gotoStart(page, "ja");
    await setWishlist(page, unresolvedMustInput("ja"));
    await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });
    await clickByText(page, ".planner-build-button", "か所で続ける");
    await page.waitForSelector(".planner-confirm-dialog", { timeout: 5_000 });
    await settle(page, 200);
    violationCount += await scan(page, "dialog-ja");
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${violationCount === 0 ? "AA scan clean" : `${violationCount} violation group(s)`}`);
if (violationCount > 0) process.exitCode = 1;
