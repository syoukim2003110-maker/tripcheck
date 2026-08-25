import assert from "node:assert/strict";
import test from "node:test";
import { appleAppAttestRootDer, parseCertificate } from "../lib/server/app-attest/certificate-chain.ts";
import { issueChallenge, verifyChallenge, issueSession, verifySession } from "../lib/server/app-attest/app-session.ts";

const env = { TRIPCHECK_QUOTA_HASH_SECRET: "unit-test-signing-secret-value" };
const NOW = 1_760_000_000;

test("the Apple production root parses as a P-384 CA valid to 2045", () => {
  const root = parseCertificate(appleAppAttestRootDer());
  assert.equal(root.curve, "P-384");
  assert.ok(root.notAfter > Date.parse("2045-01-01T00:00:00Z") / 1000);
});

test("a challenge verifies fresh, expires late, and rejects tampering", async () => {
  const challenge = (await issueChallenge(env, NOW, "0".repeat(32)))!;
  assert.deepEqual(await verifyChallenge(env, challenge, NOW), { ok: true });
  assert.equal((await verifyChallenge(env, challenge, NOW + 4000)).ok, false);
  assert.equal((await verifyChallenge(env, challenge.slice(0, -1) + (challenge.at(-1) === "A" ? "B" : "A"), NOW)).ok, false);
  assert.deepEqual(await verifyChallenge({}, challenge, NOW), { ok: false, code: "no_signing_secret" });
});

test("a session verifies before its expiry and fails after", async () => {
  const issued = (await issueSession(env, "abc123", NOW))!;
  assert.equal(issued.expiresAt, NOW + 86_400);
  const ok = await verifySession(env, issued.session, NOW + 10);
  assert.equal(ok.ok, true);
  assert.equal((await verifySession(env, issued.session, NOW + 90_000)).ok, false);
});

test("a session rejects a swapped keyId", async () => {
  const issued = (await issueSession(env, "abc123", NOW))!;
  const parts = issued.session.split(".");
  const tamperedSession = [parts[0], "xyz789", parts[2], parts[3], parts[4]].join(".");
  assert.equal((await verifySession(env, tamperedSession, NOW + 10)).ok, false);
});
