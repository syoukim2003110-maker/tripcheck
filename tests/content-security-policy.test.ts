import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contentSecurityPolicy, secureResponse } from "../lib/security-headers.ts";

const directives = new Map(
  contentSecurityPolicy().split(";").map((entry) => {
    const [name, ...values] = entry.trim().split(/\s+/);
    return [name, values] as const;
  }),
);

const sourceList = (name: string) => {
  const values = directives.get(name);
  assert.ok(values, `${name} is missing from the policy`);
  return values;
};

test("every directive the policy needs is present", () => {
  for (const name of [
    "default-src", "base-uri", "object-src", "frame-ancestors", "form-action",
    "script-src", "style-src", "font-src", "img-src", "connect-src",
    "worker-src", "frame-src",
  ]) {
    assert.ok(directives.has(name), `${name} is missing`);
  }
});

test("no fetch directive falls back to a bare scheme", () => {
  // `https:` as a source is every host on the internet. It was the whole
  // allowance for img-src and connect-src, which made an <img src> or a
  // fetch() an exfiltration channel for anything that got script onto the
  // page. A scheme source is only acceptable for opaque local schemes.
  for (const [name, values] of directives) {
    for (const value of values) {
      if (value === "data:" || value === "blob:") continue;
      assert.notEqual(value, "https:", `${name} allows every https host`);
      assert.notEqual(value, "http:", `${name} allows every http host`);
      assert.notEqual(value, "wss:", `${name} allows every websocket host`);
      assert.notEqual(value, "*", `${name} allows everything`);
    }
  }
});

test("only named map providers are allowed, on the directives they need", () => {
  const remote = (name: string) => sourceList(name).filter((value) => value.startsWith("http"));
  // Sight photos are Wikimedia Commons thumbnails; nothing else may be added
  // to img-src without a reason written here.
  // One wildcard on Wikimedia's own domain: the thumbnail host has moved
  // (upload → thumb) and a host-by-host list broke every photo when it did.
  // HotPepper Gourmet serves the restaurant photos shown (with its credit) in the meal list.
  const photoHosts = ["https://*.wikimedia.org", "https://imgfp.hotp.jp"];
  // MapKit JS (the booklet's Apple map and Apple's place card) is one host:
  // its script, the map's tiles (connect-src), Apple's logo on the map
  // (img-src, the one image the map shows as an <img>) and the frame the
  // place card is drawn in. Seen under this policy; see security-headers.ts.
  const mapKitHost = "https://cdn.apple-mapkit.com";
  assert.deepEqual(remote("img-src").filter((value) => !/google|gstatic|ggpht/.test(value)), [...photoHosts, mapKitHost]);
  assert.ok(remote("script-src").includes(mapKitHost));
  assert.ok(remote("frame-src").includes(mapKitHost));
  // No wildcard over Apple's hosts: its usage report (gsp10) stays blocked.
  for (const name of directives.keys()) {
    assert.equal(remote(name).some((value) => value.includes("*.apple-mapkit.com")), false, `${name} allows every Apple map host`);
  }
  for (const name of ["script-src", "img-src", "frame-src"]) {
    for (const value of remote(name).filter((entry) => !photoHosts.includes(entry) && entry !== mapKitHost)) {
      assert.match(
        value,
        /^https:\/\/(\*\.)?(googleapis|gstatic|google|googleusercontent|ggpht)\.com$|^https:\/\/(www|maps)\.google\.com$/,
        `${name} names a non-Google host: ${value}`,
      );
    }
  }
  // connect-src: the public data services the in-page place lookup asks
  // directly, and Apple's map. OpenFreeMap is gone with the MapLibre map.
  const keyFreeHosts = remote("connect-src").filter((value) => !/google|gstatic/.test(value));
  assert.deepEqual(keyFreeHosts, [
    "https://*.wikipedia.org",
    "https://www.wikidata.org",
    "https://query.wikidata.org",
    "https://photon.komoot.io",
    "https://nominatim.openstreetmap.org",
    "https://routing.openstreetmap.de",
    "https://api.open-meteo.com",
    "https://date.nager.at",
    // MapKit JS: start-up call, strings and the map's tiles (cdn), and the
    // place card's place lookup (api). Apple's usage report
    // (gsp10.apple-mapkit.com) is deliberately absent.
    "https://cdn.apple-mapkit.com",
    "https://api.apple-mapkit.com",
  ]);
  assert.equal(contentSecurityPolicy().includes("openfreemap"), false, "the MapLibre map and its tiles are gone");
  assert.deepEqual(remote("default-src"), []);
  assert.deepEqual(remote("style-src"), []);
  assert.deepEqual(remote("font-src"), []);
});

test("the booklet's map loads MapKit JS from the CSP-pinned Apple host", () => {
  const loader = readFileSync(new URL("../lib/mapkit-loader.ts", import.meta.url), "utf8");
  const scriptUrl = /MAPKIT_SCRIPT_URL\s*=\s*"([^"]+)"/.exec(loader)?.[1];
  assert.ok(scriptUrl, "the MapKit JS address moved");
  assert.ok(sourceList("script-src").includes(new URL(scriptUrl).origin));
  const map = readFileSync(new URL("../app/shiori/ShioriMap.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(map, /maplibre|openfreemap/i, "the booklet draws on Apple's map only");
  assert.match(map, /loadMapKit\(/);
});

test("the image hosts cover what the app actually renders", () => {
  const images = sourceList("img-src");
  // The Places photo route answers with a redirect to Google's media CDN, and
  // CSP re-checks the host after a redirect. The Places attribution badge is
  // a direct gstatic image.
  assert.ok(images.includes("https://*.googleusercontent.com"));
  assert.ok(images.includes("https://*.gstatic.com"));
  assert.ok(images.includes("'self'"), "proxied thumbnails are same-origin");

  const attribution = readFileSync(new URL("../app/components/planner/start/PlaceInputAutocomplete.tsx", import.meta.url), "utf8");
  const badge = /src="(https:\/\/[^"]+)"/.exec(attribution)?.[1];
  assert.ok(badge?.startsWith("https://maps.gstatic.com/"), "the attribution badge moved host");
});

test("no component points an <img> at an unproxied remote URL", () => {
  // Both remote image families go through a same-origin route that requires a
  // server-minted signature: Places photos through /api/place-photo, link
  // preview thumbnails through /api/link-image. A component that reintroduces
  // a raw remote src would silently need img-src to reopen.
  const files = [
    "../app/components/planner/inspector/StopInspector.tsx",
    "../app/components/planner/inspector/HotelInspector.tsx",
    "../app/components/planner/recommendation/HotelRecommendationCard.tsx",
    "../app/components/planner/recommendation/MealRecommendationCard.tsx",
    "../app/components/planner/recommendation/GapRecommendationCard.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const [, expression] of source.matchAll(/<img[\s\S]*?src=\{([^}]*)\}/g)) {
      assert.match(
        expression.trim(),
        /^(placePhotoSrc|linkImageSrc)\(/,
        `${file} renders an image from ${expression.trim()}`,
      );
    }
  }
});

test("localhost keeps its development freedom, production does not", () => {
  const local = secureResponse(new Response("ok"), "http://localhost:8788/ja");
  assert.equal(local.headers.get("Content-Security-Policy"), null);
  assert.equal(local.headers.get("Strict-Transport-Security"), null);

  const live = secureResponse(new Response("ok"), "https://tripcheck.example/ja");
  assert.equal(live.headers.get("Content-Security-Policy"), contentSecurityPolicy());
  assert.match(live.headers.get("Strict-Transport-Security") ?? "", /max-age=31536000/);
  assert.equal(live.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(live.headers.get("X-Frame-Options"), "DENY");
});
