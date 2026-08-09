import assert from "node:assert/strict";
import test from "node:test";

import { contentSecurityPolicy, secureResponse } from "../lib/security-headers.ts";

test("production responses receive CSP and transport/security headers", async () => {
  const secured = secureResponse(new Response("ok", { headers: { "Content-Type": "text/plain" } }), "https://tripcheck.example/result");
  assert.equal(await secured.text(), "ok");
  assert.equal(secured.headers.get("content-type"), "text/plain");
  assert.equal(secured.headers.get("x-content-type-options"), "nosniff");
  assert.equal(secured.headers.get("x-frame-options"), "DENY");
  assert.equal(secured.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(secured.headers.get("content-security-policy"), contentSecurityPolicy());
  assert.match(contentSecurityPolicy(), /object-src 'none'/);
  assert.match(contentSecurityPolicy(), /frame-ancestors 'none'/);
});

test("localhost keeps security headers but omits production CSP and HSTS", () => {
  const secured = secureResponse(new Response(null, { status: 204 }), "http://localhost:3000/");
  assert.equal(secured.status, 204);
  assert.equal(secured.headers.get("content-security-policy"), null);
  assert.equal(secured.headers.get("strict-transport-security"), null);
  assert.equal(secured.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
});

test("security wrapper preserves status, status text and existing cache headers", () => {
  const secured = secureResponse(new Response("missing", {
    status: 404,
    statusText: "Not Found",
    headers: { "Cache-Control": "private, no-store" },
  }), new URL("https://tripcheck.example/missing"));
  assert.equal(secured.status, 404);
  assert.equal(secured.statusText, "Not Found");
  assert.equal(secured.headers.get("cache-control"), "private, no-store");
});
