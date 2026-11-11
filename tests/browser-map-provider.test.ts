import assert from "node:assert/strict";
import { test } from "node:test";
import { browserGoogleMapsApiKey } from "../lib/browser-map-provider.ts";

test("a browser key alone never enables billable Google map loads", () => {
  assert.equal(browserGoogleMapsApiKey({
    GOOGLE_MAPS_BROWSER_API_KEY: "stale-key",
    NEXT_PUBLIC_TRIPCHECK_GOOGLE_MAP_ENABLED: undefined,
  }), "");
  assert.equal(browserGoogleMapsApiKey({
    GOOGLE_MAPS_BROWSER_API_KEY: "stale-key",
    NEXT_PUBLIC_TRIPCHECK_GOOGLE_MAP_ENABLED: "false",
  }), "");
});

test("Google maps require an exact opt-in and a non-empty key", () => {
  assert.equal(browserGoogleMapsApiKey({
    GOOGLE_MAPS_BROWSER_API_KEY: "  browser-key  ",
    NEXT_PUBLIC_TRIPCHECK_GOOGLE_MAP_ENABLED: "true",
  }), "browser-key");
  assert.equal(browserGoogleMapsApiKey({
    GOOGLE_MAPS_BROWSER_API_KEY: "   ",
    NEXT_PUBLIC_TRIPCHECK_GOOGLE_MAP_ENABLED: "true",
  }), "");
});
