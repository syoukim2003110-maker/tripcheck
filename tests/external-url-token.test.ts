import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EXTERNAL_URL_TOKEN_TTL_SECONDS,
  mintExternalUrlSignature,
  signExternalUrl,
  signFindingUrls,
  verifyExternalUrlToken,
} from "../lib/server/external-url-token.ts";
import { mintPlacePhotoSignature, verifyPlacePhotoToken } from "../lib/server/place-photo-token.ts";

const secret = "test-secret-value-at-least-16";
const env = { TRIPCHECK_PHOTO_TOKEN_SECRET: secret };
const now = 1_760_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const target = "https://example.com/guide/kyoto";

test("a signature the server minted verifies, and nothing else does", async () => {
  const token = await mintExternalUrlSignature(target, env, now);
  assert.ok(token);
  assert.equal(await verifyExternalUrlToken({ url: target, token, secret, nowSeconds }), true);

  // A different URL under the same signature is the whole attack: point the
  // route somewhere else while replaying a token it issued.
  assert.equal(
    await verifyExternalUrlToken({ url: "https://attacker.example/x", token, secret, nowSeconds }),
    false,
  );
  assert.equal(await verifyExternalUrlToken({ url: target, token: `${token}x`, secret, nowSeconds }), false);
  assert.equal(
    await verifyExternalUrlToken({ url: target, token, secret: "other-secret-value-16chars", nowSeconds }),
    false,
  );
  assert.equal(await verifyExternalUrlToken({ url: target, token: "", secret, nowSeconds }), false);
});

test("expiry is enforced at both ends", async () => {
  const token = await mintExternalUrlSignature(target, env, now);
  assert.ok(token);
  assert.equal(
    await verifyExternalUrlToken({ url: target, token, secret, nowSeconds: nowSeconds + EXTERNAL_URL_TOKEN_TTL_SECONDS - 1 }),
    true,
  );
  assert.equal(
    await verifyExternalUrlToken({ url: target, token, secret, nowSeconds: nowSeconds + EXTERNAL_URL_TOKEN_TTL_SECONDS + 2 }),
    false,
  );
  // A valid MAC over a far-future expiry would otherwise be a permanent grant.
  const forever = await signExternalUrl(target, secret, nowSeconds + 400 * 24 * 3_600);
  assert.ok(forever);
  assert.equal(await verifyExternalUrlToken({ url: target, token: forever, secret, nowSeconds }), false);
});

test("only a URL the outbound policy already accepts can be signed", async () => {
  for (const blocked of [
    "http://example.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/x",
    "https://user:pass@example.com/x",
    "https://example.com:8443/x",
    "https://example.internal/x",
  ]) {
    assert.equal(await mintExternalUrlSignature(blocked, env, now), null, `signed ${blocked}`);
  }
});

test("a photo signature cannot be replayed as a URL signature, or the reverse", async () => {
  const photoName = "places/ChIJabcdefghij/photos/AbCdEfGhIjKlMnOpQrStUv";
  const photoToken = await mintPlacePhotoSignature(photoName, env, now);
  const urlToken = await mintExternalUrlSignature(target, env, now);
  assert.ok(photoToken && urlToken);
  assert.notEqual(photoToken, urlToken);
  assert.equal(await verifyExternalUrlToken({ url: target, token: photoToken, secret, nowSeconds }), false);
  assert.equal(await verifyPlacePhotoToken({ photoName, token: urlToken, secret, nowSeconds }), false);
});

test("findings are signed without writing back into the cached result", async () => {
  const cached = {
    summary: "s",
    findings: [
      { title: "a", url: target },
      { title: "b", url: "https://example.org/b" },
      { title: "blocked", url: "https://127.0.0.1/b" },
    ],
  };
  const signed = await signFindingUrls(cached, env, now);
  assert.notEqual(signed, cached);
  assert.equal(cached.findings.every((finding) => !("urlSignature" in finding)), true);

  const [first, second, blocked] = signed.findings as unknown as Array<{ url: string; urlSignature: string | null }>;
  assert.ok(first.urlSignature);
  assert.ok(second.urlSignature);
  assert.equal(blocked.urlSignature, null, "a URL the fetch would refuse gets no credential");
  assert.equal(await verifyExternalUrlToken({ url: first.url, token: first.urlSignature, secret, nowSeconds }), true);
  // Signatures are per URL, so one finding's token does not open another.
  assert.equal(await verifyExternalUrlToken({ url: second.url, token: first.urlSignature, secret, nowSeconds }), false);
});

test("no secret means no signature, never an unsigned grant", async () => {
  assert.equal(await mintExternalUrlSignature(target, {}, now), null);
  assert.equal(await mintExternalUrlSignature(target, { TRIPCHECK_PHOTO_TOKEN_SECRET: "short" }, now), null);
});

test("both fetching routes refuse anything unsigned", () => {
  const preview = readFileSync(new URL("../app/api/link-preview/route.ts", import.meta.url), "utf8");
  const image = readFileSync(new URL("../app/api/link-image/route.ts", import.meta.url), "utf8");
  for (const [name, source] of [["link-preview", preview], ["link-image", image]] as const) {
    assert.match(source, /verifyExternalUrlToken/, `${name} does not verify a signature`);
    assert.match(source, /\b403\b/, `${name} has no refusal path`);
  }
  // The image proxy must not become a general one: bytes capped, type fixed,
  // and no redirect-following to a host that was never checked.
  assert.match(image, /redirect: "error"/);
  assert.match(image, /MAX_IMAGE_BYTES/);
  assert.match(image, /ALLOWED_TYPES/);
  assert.match(image, /assertPublicNetworkTarget/);
});

test("the preview re-checks the address after the response, not only before", () => {
  const source = readFileSync(new URL("../lib/link-preview.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function fetchLinkPreview"));
  const checks = [...body.matchAll(/assertPublicNetworkTarget/g)].length;
  assert.ok(checks >= 2, `expected a pre- and post-fetch check, found ${checks}`);
  // The second one has to sit before the body is read, or a private response
  // is parsed and returned before anything notices.
  assert.ok(
    body.lastIndexOf("assertPublicNetworkTarget") < body.indexOf("readLimitedText(response)"),
    "the post-fetch check runs after the body is read",
  );
});
