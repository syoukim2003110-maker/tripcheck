import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { ui } from "../lib/presentation/planner-copy.ts";

/*
 * TC-068 + COPY-EXTRA contract: internal/technical vocabulary must never
 * reach the planner UI. The banned classes and their user replacements:
 *
 *   実測                       → 「Google Maps経路データ」/「確認済みの経路」
 *   判定保留 / 判定を保留 / 判定は保留 → outcome phrasing
 *                                (「確認が終わるまで結論を出しません」-class)
 *   対応品質 / 地域品質         → 「この地域の対応」 / "Coverage in this region"
 *   ○○API-style provider-internal names → attribution vocabulary only
 *                                (Google Maps / Rakuten Travel / Open-Meteo /
 *                                Claude are ALLOWED as data-source labels and
 *                                do not match these patterns; "Places API",
 *                                "Routes API" etc. do and stay banned)
 *
 * Scope mirrors plannerSurfaceFiles() in tests/privacy-contract.test.mjs
 * (app/TripPlannerApp.tsx, app/components/planner/** recursively,
 * lib/presentation/**, lib/planner-app-state.ts) and adds the top-level
 * planner-surface modules that render into the same page:
 *   - app/PlannerGoogleMap.tsx, app/PlannerDayTimeBar.tsx,
 *     app/AirportOptionComparison.tsx, app/SearchableCombobox.tsx
 *     (planner components that predate the components/planner move)
 *   - app/StructuredData.tsx (its SEO FAQ text is emitted into the rendered
 *     plan page HTML, so it is IN scope rather than excluded)
 *   - lib/coverage-profile.ts (its publicCopy strings render verbatim inside
 *     TripSummaryCard / TripPrintSheet)
 *
 * Explicit exclusions (and why):
 *   - app/ja, app/ko, app/zh, app/privacy, app/terms: standalone marketing /
 *     legal pages, not the planner surface; their copy is audited separately.
 *   - app/api/**: server route code, never rendered as UI copy.
 *   - lib/** service/engine modules other than the two named above: they
 *     produce data, not display strings; anything they surface must pass
 *     through lib/presentation/**, which IS scanned.
 */

const bannedPatterns: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "実測 (measurement jargon)", pattern: /実測/ },
  { name: "判定保留 (internal-state jargon)", pattern: /判定を保留|判定は保留|判定保留/ },
  { name: "対応品質/地域品質 (coverage-grade jargon)", pattern: /対応品質|地域品質/ },
  // Uppercase, word-bounded API. Lowercase route paths ("/api/place-photo",
  // "?api=1") and identifiers like API_KEY (no word boundary before "_") do
  // not match; a displayed "Places API"-style provider name does.
  { name: "provider-internal API naming", pattern: /\bAPI\b/ },
];

/**
 * Blanks out // and /* *\/ comments while respecting string and template
 * literals, so documentation may mention a term without shipping it and a
 * "https://" URL inside a string never looks like a comment. String and
 * template literal contents plus JSX text stay in the scanned output.
 */
function stripComments(source: string) {
  let out = "";
  let index = 0;
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  const templateDepth: number[] = [];
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "code") {
      if (char === "/" && next === "/") { mode = "line"; out += "  "; index += 2; continue; }
      if (char === "/" && next === "*") { mode = "block"; out += "  "; index += 2; continue; }
      if (char === "'") mode = "single";
      else if (char === '"') mode = "double";
      else if (char === "`") mode = "template";
      else if (char === "}" && templateDepth.length > 0) {
        if (templateDepth[templateDepth.length - 1] === 0) { templateDepth.pop(); mode = "template"; }
        else templateDepth[templateDepth.length - 1] -= 1;
      } else if (char === "{" && templateDepth.length > 0) {
        templateDepth[templateDepth.length - 1] += 1;
      }
      out += char; index += 1; continue;
    }
    if (mode === "line") {
      if (char === "\n") { mode = "code"; out += char; } else out += " ";
      index += 1; continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") { mode = "code"; out += "  "; index += 2; continue; }
      out += char === "\n" ? "\n" : " "; index += 1; continue;
    }
    // Inside a string/template literal.
    if (char === "\\") { out += source.slice(index, index + 2); index += 2; continue; }
    if (mode === "single" && char === "'") mode = "code";
    else if (mode === "double" && char === '"') mode = "code";
    else if (mode === "template" && char === "`") mode = "code";
    else if (mode === "template" && char === "$" && next === "{") {
      templateDepth.push(0); mode = "code"; out += "${"; index += 2; continue;
    }
    out += char; index += 1; continue;
  }
  return out;
}

async function bannedTermSurfaceFiles() {
  const files: Array<{ path: string; url: URL }> = [
    "app/TripPlannerApp.tsx",
    "app/PlannerGoogleMap.tsx",
    "app/PlannerDayTimeBar.tsx",
    "app/AirportOptionComparison.tsx",
    "app/SearchableCombobox.tsx",
    "app/StructuredData.tsx",
    "lib/planner-app-state.ts",
    "lib/coverage-profile.ts",
  ].map((path) => ({ path, url: new URL(`../${path}`, import.meta.url) }));
  const roots = [
    { url: new URL("../app/components/planner/", import.meta.url), prefix: "app/components/planner/", filter: /\.tsx?$/ },
    { url: new URL("../lib/presentation/", import.meta.url), prefix: "lib/presentation/", filter: /\.ts$/ },
  ];
  for (const root of roots) {
    const entries = await readdir(root.url, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !root.filter.test(entry.name)) continue;
      const fileUrl = new URL(`${entry.parentPath.replace(/\/?$/, "/")}${entry.name}`, "file://");
      files.push({ path: fileUrl.pathname, url: fileUrl });
    }
  }
  return Promise.all(files.map(async (file) => ({ path: file.path, text: await readFile(file.url, "utf8") })));
}

function collectStrings(value: unknown, into: string[]) {
  if (typeof value === "string") into.push(value);
  else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, into);
  }
  // Functions are covered by the planner-copy.ts source scan below.
}

test("the patterns themselves still catch each banned class", () => {
  const seeded: Array<[string, string]> = [
    ["実測 (measurement jargon)", "ホテルまでの実測ではありません"],
    ["判定保留 (internal-state jargon)", "判定を保留しています"],
    ["判定保留 (internal-state jargon)", "判定は保留になります"],
    ["判定保留 (internal-state jargon)", "条件付きまたは判定保留と表示します"],
    ["対応品質/地域品質 (coverage-grade jargon)", "地域別の対応品質"],
    ["provider-internal API naming", "Uses the Places API for lookup"],
  ];
  for (const [name, sample] of seeded) {
    const rule = bannedPatterns.find((candidate) => candidate.name === name)!;
    assert.match(sample, rule.pattern, `${name} must match ${sample}`);
  }
  // Allowed attributions and non-display API tokens must NOT match.
  const api = bannedPatterns.find((candidate) => candidate.name === "provider-internal API naming")!;
  for (const allowed of ["Google Maps経路データ", "Rakuten Travel", "Open-Meteo", "Claude", "/api/place-photo", "?api=1", "GOOGLE_MAPS_API_KEY"]) {
    assert.doesNotMatch(allowed, api.pattern, `${allowed} must stay allowed`);
  }
});

test("the ja/en ui copy table carries no banned technical terms", () => {
  const strings: string[] = [];
  collectStrings(ui.ja, strings);
  collectStrings(ui.en, strings);
  assert.ok(strings.length > 100, `ui table walk looks too small: ${strings.length} strings`);
  for (const value of strings) {
    for (const rule of bannedPatterns) {
      assert.doesNotMatch(value, rule.pattern, `${rule.name} in ui copy: ${value}`);
    }
  }
});

test("planner surface source (literals and JSX text) carries no banned technical terms", async () => {
  const surface = await bannedTermSurfaceFiles();
  assert.ok(surface.length > 30, `planner surface enumeration looks too small: ${surface.length} files`);
  for (const { path, text } of surface) {
    const scannable = stripComments(text);
    for (const rule of bannedPatterns) {
      const match = scannable.match(rule.pattern);
      assert.equal(match, null, `${rule.name} reintroduced in ${path}: “${match?.[0]}”`);
    }
  }
});

/*
 * UI/UX v3.1 §2.1: the confidence marker is demoted, not deleted.
 *
 * `durationSourceLabel` renders 推定 / 確認 / 指定 — a code the traveller has
 * to learn, and exactly the class of signal the v3.1 handoff moves off the
 * itinerary. It is allowed to survive one control away, inside the stop
 * sheet's evidence disclosure, and nowhere else on the planner surface.
 *
 * The pairing matters more than either half. A timeline that dropped the badge
 * without adopting `stayLine`'s hedged wording would print every default
 * duration as a measured fact; a sheet that lost the disclosure would leave the
 * traveller no way to find out which numbers TripCheck actually checked. So
 * this asserts both directions: the badge is gone from the rows, the hedge is
 * present in them, and the receptacle still exists.
 */
test("the stay-confidence marker lives in the sheet, and the timeline hedges instead", async () => {
  const surface = await bannedTermSurfaceFiles();
  const byName = (suffix: string) => surface.find((file) => file.path.endsWith(suffix));

  const callers = surface
    .filter((file) => !file.path.endsWith("lib/presentation/timeline-presentation.ts"))
    .filter((file) => /\bdurationSourceLabel\s*\(/.test(stripComments(file.text)))
    .map((file) => file.path.replace(/^.*\/(app|lib)\//, "$1/"));
  assert.deepEqual(
    callers,
    ["app/components/planner/inspector/StopInspector.tsx"],
    `the 推定 / 確認 / 指定 marker may only render inside the stop sheet's evidence disclosure, but is called from: ${callers.join(", ")}`,
  );

  const activityCard = byName("planner/timeline/ActivityCard.tsx");
  assert.ok(activityCard, "ActivityCard is part of the scanned planner surface");
  const activitySource = stripComments(activityCard.text);
  assert.match(activitySource, /\bstayLine\s*\(/, "the stop row must state its stay through the hedged builder");

  const inspector = byName("planner/inspector/StopInspector.tsx");
  assert.ok(inspector, "StopInspector is part of the scanned planner surface");
  const inspectorSource = stripComments(inspector.text);
  assert.match(inspectorSource, /evidenceDisclosureLabel\s*\(/, "the sheet must still carry the evidence disclosure the marker moved into");
  assert.match(inspectorSource, /stayBasisLine\s*\(/, "the disclosure must say where the stay length came from");
});
