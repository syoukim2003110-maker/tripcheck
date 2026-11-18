import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RETIRED_PAGES, copiedIntoStaticBuild } from "../scripts/static-build-scope.ts";

/*
 * The old planner (/classic) showed Apple travel times and search results
 * without an Apple map. The static site is built without it, nothing links
 * to it, and the deploy step removes a copy an earlier build left on the host.
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the static build copies no /classic page and no server route", () => {
  for (const left of ["app/classic", "app/classic/page.tsx", "app/classic/ja/page.tsx", "app/api", "app/api/x/route.ts"]) {
    assert.equal(copiedIntoStaticBuild(root, join(root, left)), false, left);
  }
  for (const kept of ["app", "app/page.tsx", "app/ja/page.tsx", "app/shiori/ShioriApp.tsx", "app/classical/page.tsx", "lib/shiori/plan.ts", "public"]) {
    assert.equal(copiedIntoStaticBuild(root, join(root, kept)), true, kept);
  }
  // The build uses that filter, not one of its own.
  const build = read("scripts/build-static.ts");
  assert.match(build, /filter: \(source\) => copiedIntoStaticBuild\(root, source\)/);
  // Every page folder in app/ other than the old planner would be built;
  // none of them is the old planner under another name.
  const pages = readdirSync(join(root, "app"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const page of pages.filter((name) => copiedIntoStaticBuild(root, join(root, "app", name)))) {
    for (const file of readdirSync(join(root, "app", page), { recursive: true }).map(String).filter((name) => name.endsWith("page.tsx"))) {
      assert.doesNotMatch(read(`app/${page}/${file}`), /TripPlannerApp/, `app/${page}/${file} serves the old planner`);
    }
  }
  assert.doesNotMatch(read("app/page.tsx"), /TripPlannerApp/);
});

test("nothing the static site builds links to /classic", () => {
  const files = readdirSync(join(root, "app"), { recursive: true }).map(String)
    .filter((name) => /\.(tsx?|mjs)$/.test(name))
    .filter((name) => copiedIntoStaticBuild(root, join(root, "app", name)))
    // The old planner's own components are built only if a page imports them.
    .filter((name) => !name.startsWith("components/") && name !== "TripPlannerApp.tsx");
  for (const name of files) {
    assert.doesNotMatch(read(`app/${name}`), /["'`]\/classic\b/, `app/${name} links to /classic`);
  }
  for (const name of readdirSync(join(root, "public"), { recursive: true }).map(String).filter((file) => /\.(xml|txt|html|json|webmanifest)$/.test(file) && !file.startsWith("rail/"))) {
    assert.doesNotMatch(read(`public/${name}`), /\/classic\b/, `public/${name} links to /classic`);
  }
});

test("the deploy step removes the old planner left on the host by an earlier build", () => {
  assert.deepEqual([...RETIRED_PAGES], ["classic", "maplibre"]);
  const deploy = read("deploy/xserver/api/deploy.php");
  assert.match(deploy, /const RETIRED_PAGES = \['classic', 'maplibre'\];/);
  // Both ways of finishing a deploy (from the zip, from an extracted folder) remove it.
  assert.equal(deploy.match(/\$retired = remove_retired_pages\(\$root\);/g)?.length, 2);
});
