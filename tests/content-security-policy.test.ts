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

test("only Google hosts are named, and only where the map needs them", () => {
  const remote = (name: string) => sourceList(name).filter((value) => value.startsWith("http"));
  for (const name of ["script-src", "img-src", "connect-src", "frame-src"]) {
    for (const value of remote(name)) {
      assert.match(
        value,
        /^https:\/\/(\*\.)?(googleapis|gstatic|google|googleusercontent|ggpht)\.com$|^https:\/\/(www|maps)\.google\.com$/,
        `${name} names a non-Google host: ${value}`,
      );
    }
  }
  assert.deepEqual(remote("default-src"), []);
  assert.deepEqual(remote("style-src"), []);
  assert.deepEqual(remote("font-src"), []);
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
