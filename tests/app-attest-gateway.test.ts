import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_SESSION_HEADER,
  handleAppGateway,
  type AppGatewayEnvironment,
} from "../lib/server/app-attest/gateway.ts";
import { processLocalAppAttestKeyStore } from "../lib/server/app-attest/key-store.ts";
import {
  base64,
  buildAssertion,
  buildAttestation,
  makeDeviceKey,
  makeIntermediate,
  makeRootCa,
} from "./helpers/app-attest-fixtures.ts";

const APP_ID = "T8L5BPC2XJ.com.muraoshoki.tripcheck";
const NOW = 1_760_000_000;

function baseEnv(overrides: Partial<AppGatewayEnvironment> = {}): AppGatewayEnvironment {
  return {
    TRIPCHECK_QUOTA_HASH_SECRET: "unit-test-signing-secret-value",
    TRIPCHECK_APP_IDS: APP_ID,
    TRIPCHECK_APP_ATTEST_ENVIRONMENTS: "development",
    ...overrides,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://tripcheck.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function getChallenge(env: AppGatewayEnvironment): Promise<string> {
  const response = await handleAppGateway(post("/api/app/challenge", {}), env, { nowSeconds: NOW });
  assert.equal(response.status, 200);
  return String((await json(response)).challenge);
}

test("a synthetic attestation registers, and its session pings", async () => {
  const root = makeRootCa();
  const intermediate = makeIntermediate(root);
  const device = makeDeviceKey();
  const env = baseEnv();
  const deps = { nowSeconds: NOW, keyStore: processLocalAppAttestKeyStore(), rootCertificate: root.der };

  const challenge = await getChallenge(env);
  const attestation = buildAttestation({ root, intermediate, device, challenge, appId: APP_ID });
  const attestResponse = await handleAppGateway(
    post("/api/app/attest", { keyId: base64(device.keyId), attestation, challenge }),
    env,
    deps,
  );
  assert.equal(attestResponse.status, 200, JSON.stringify(await attestResponse.clone().json()));
  const session = String((await json(attestResponse)).session);

  const ping = await handleAppGateway(
    new Request("https://tripcheck.example/api/app/ping", { headers: { [APP_SESSION_HEADER]: session } }),
    env,
    { nowSeconds: NOW + 10, keyStore: deps.keyStore },
  );
  assert.equal(ping.status, 200);
  assert.equal((await json(ping)).ok, true);
});

test("assert re-enters with a monotonic counter and rejects a rewind", async () => {
  const root = makeRootCa();
  const intermediate = makeIntermediate(root);
  const device = makeDeviceKey();
  const env = baseEnv();
  const keyStore = processLocalAppAttestKeyStore();
  const deps = { nowSeconds: NOW, keyStore, rootCertificate: root.der };

  const challenge1 = await getChallenge(env);
  await handleAppGateway(
    post("/api/app/attest", { keyId: base64(device.keyId), attestation: buildAttestation({ root, intermediate, device, challenge: challenge1, appId: APP_ID }), challenge: challenge1 }),
    env,
    deps,
  );

  const challenge2 = await getChallenge(env);
  const good = await handleAppGateway(
    post("/api/app/assert", { keyId: base64(device.keyId), assertion: buildAssertion({ device, challenge: challenge2, appId: APP_ID, counter: 5 }), challenge: challenge2 }),
    env,
    deps,
  );
  assert.equal(good.status, 200, JSON.stringify(await good.clone().json()));

  const challenge3 = await getChallenge(env);
  const rewind = await handleAppGateway(
    post("/api/app/assert", { keyId: base64(device.keyId), assertion: buildAssertion({ device, challenge: challenge3, appId: APP_ID, counter: 5 }), challenge: challenge3 }),
    env,
    deps,
  );
  assert.equal(rewind.status, 401);
  assert.equal((await json(rewind)).code, "counter_regressed");
});

test("a tampered nonce fails, a wrong app id fails, an unknown key fails", async () => {
  const root = makeRootCa();
  const intermediate = makeIntermediate(root);
  const device = makeDeviceKey();
  const env = baseEnv();
  const deps = { nowSeconds: NOW, keyStore: processLocalAppAttestKeyStore(), rootCertificate: root.der };

  const c1 = await getChallenge(env);
  const tampered = await handleAppGateway(
    post("/api/app/attest", { keyId: base64(device.keyId), attestation: buildAttestation({ root, intermediate, device, challenge: c1, appId: APP_ID, tamperNonce: true }), challenge: c1 }),
    env,
    deps,
  );
  assert.equal(tampered.status, 401);
  assert.equal((await json(tampered)).code, "attestation_invalid");

  const c2 = await getChallenge(env);
  const wrongApp = await handleAppGateway(
    post("/api/app/attest", { keyId: base64(device.keyId), attestation: buildAttestation({ root, intermediate, device, challenge: c2, appId: "WRONGTEAM.com.evil.app" }), challenge: c2 }),
    env,
    deps,
  );
  assert.equal(wrongApp.status, 401);
  assert.equal((await json(wrongApp)).code, "app_id_mismatch");

  const c3 = await getChallenge(env);
  const unknown = await handleAppGateway(
    post("/api/app/assert", { keyId: base64(device.keyId), assertion: buildAssertion({ device, challenge: c3, appId: APP_ID, counter: 1 }), challenge: c3 }),
    env,
    deps,
  );
  assert.equal(unknown.status, 401);
  assert.equal((await json(unknown)).code, "unknown_key");
});

test("an expired challenge, an expired session, and a set kill switch all refuse", async () => {
  const env = baseEnv();
  const challenge = await getChallenge(env);
  const expiredChallenge = await handleAppGateway(
    post("/api/app/attest", { keyId: "x", attestation: "x", challenge }),
    env,
    { nowSeconds: NOW + 4000 },
  );
  assert.equal(expiredChallenge.status, 401);
  assert.equal((await json(expiredChallenge)).code, "challenge_expired");

  const disabled = await handleAppGateway(post("/api/app/challenge", {}), baseEnv({ TRIPCHECK_APP_API_DISABLED: "1" }), { nowSeconds: NOW });
  assert.equal(disabled.status, 503);
  assert.equal((await json(disabled)).code, "disabled");

  const noSecret = await handleAppGateway(post("/api/app/challenge", {}), { TRIPCHECK_APP_IDS: APP_ID }, { nowSeconds: NOW });
  assert.equal(noSecret.status, 503);
  assert.equal((await json(noSecret)).code, "no_signing_secret");
});

test("bypass is fail-closed unless the token is configured and matches", async () => {
  const withoutToken = baseEnv();
  const c1 = await getChallenge(withoutToken);
  const off = await handleAppGateway(post("/api/app/attest", { bypassToken: "anything", challenge: c1 }), withoutToken, { nowSeconds: NOW });
  assert.equal(off.status, 401);
  assert.equal((await json(off)).code, "bypass_disabled");

  const withToken = baseEnv({ TRIPCHECK_APP_ATTEST_BYPASS_TOKEN: "local-dev-token" });
  const c2 = await getChallenge(withToken);
  const on = await handleAppGateway(post("/api/app/attest", { bypassToken: "local-dev-token", challenge: c2 }), withToken, { nowSeconds: NOW });
  assert.equal(on.status, 200, JSON.stringify(await on.clone().json()));
  assert.ok(String((await json(on)).session).startsWith("v1.bypass-local."));
});

test("a chain that doesn't reach the injected root fails, and an assertion signed by the wrong device fails", async () => {
  const root = makeRootCa();
  const intermediate = makeIntermediate(root);
  const device = makeDeviceKey();
  const otherRoot = makeRootCa();
  const env = baseEnv();

  const c1 = await getChallenge(env);
  const wrongChain = await handleAppGateway(
    post("/api/app/attest", { keyId: base64(device.keyId), attestation: buildAttestation({ root, intermediate, device, challenge: c1, appId: APP_ID }), challenge: c1 }),
    env,
    { nowSeconds: NOW, keyStore: processLocalAppAttestKeyStore(), rootCertificate: otherRoot.der },
  );
  assert.equal(wrongChain.status, 401);
  assert.equal((await json(wrongChain)).code, "attestation_invalid");

  const keyStore = processLocalAppAttestKeyStore();
  const deps = { nowSeconds: NOW, keyStore, rootCertificate: root.der };
  const c2 = await getChallenge(env);
  await handleAppGateway(
    post("/api/app/attest", { keyId: base64(device.keyId), attestation: buildAttestation({ root, intermediate, device, challenge: c2, appId: APP_ID }), challenge: c2 }),
    env,
    deps,
  );

  const impostor = makeDeviceKey();
  const c3 = await getChallenge(env);
  const wrongSigner = await handleAppGateway(
    post("/api/app/assert", { keyId: base64(device.keyId), assertion: buildAssertion({ device: impostor, challenge: c3, appId: APP_ID, counter: 1 }), challenge: c3 }),
    env,
    deps,
  );
  assert.equal(wrongSigner.status, 401);
  assert.equal((await json(wrongSigner)).code, "assertion_invalid");
});
