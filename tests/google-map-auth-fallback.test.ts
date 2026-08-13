import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("map auth rejection is converted to a local unavailable state", () => {
  const source = readFileSync(new URL("../app/PlannerGoogleMap.tsx", import.meta.url), "utf8");
  assert.match(source, /gm_authFailure/);
  assert.match(source, /MAPS_AUTH_FAILURE_EVENT/);
  assert.match(source, /engineState === "unavailable"/);
  assert.match(source, /地図を読み込めません/);
  assert.doesNotMatch(source, /<iframe[\s\S]*?\/api\/map-embed/);
});
