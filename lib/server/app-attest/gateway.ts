/**
 * The `/api/app/*` gateway: the native app's door into this Worker. It runs
 * before the browser-only same-origin gate and owns exactly four routes:
 * challenge, attest, assert, ping. Everything here is fail-closed — no
 * signing secret, no configured App ID, or a set kill switch all refuse.
 *
 * These routes never appear in `lib/server/api-route-policy.ts`: that
 * manifest is diffed against `app/api/**` route files exactly, and this
 * gateway has no origin-side handler. APP_GATEWAY_ROUTES below is the
 * equivalent single source of truth, pinned by its own test.
 */

import type { SigningEnvironment } from "../hmac-signature.ts";
import { base64ToBytes, bytesToBase64Url, randomHex } from "./bytes.ts";
import {
  issueChallenge,
  issueSession,
  verifyChallenge,
  verifySession,
} from "./app-session.ts";
import { verifyAttestation, type AttestEnvironment } from "./attestation.ts";
import { verifyAssertion } from "./assertion.ts";
import { appleAppAttestRootDer } from "./certificate-chain.ts";
import {
  d1AppAttestKeyStore,
  processLocalAppAttestKeyStore,
  type AppAttestKeyStore,
  type D1DatabaseLike,
} from "./key-store.ts";

export const APP_SESSION_HEADER = "X-TripCheck-App-Session";
export const BYPASS_KEY_ID = "bypass-local";

export const APP_GATEWAY_ROUTES = Object.freeze([
  Object.freeze({ method: "POST", path: "/api/app/challenge", auth: "none" } as const),
  Object.freeze({ method: "POST", path: "/api/app/attest", auth: "none" } as const),
  Object.freeze({ method: "POST", path: "/api/app/assert", auth: "none" } as const),
  Object.freeze({ method: "GET", path: "/api/app/ping", auth: "app_session" } as const),
] as const);

export function isAppGatewayPath(pathname: string): boolean {
  return pathname === "/api/app" || pathname.startsWith("/api/app/");
}

export interface AppGatewayEnvironment extends SigningEnvironment {
  readonly DB?: D1DatabaseLike;
  readonly TRIPCHECK_APP_IDS?: string;
  readonly TRIPCHECK_APP_ATTEST_ENVIRONMENTS?: string;
  readonly TRIPCHECK_APP_ATTEST_BYPASS_TOKEN?: string;
  readonly TRIPCHECK_APP_API_DISABLED?: string;
}

/** Injection points for tests; production callers pass nothing. */
export interface AppGatewayDependencies {
  readonly nowSeconds?: number;
  readonly nonceHex?: () => string;
  readonly keyStore?: AppAttestKeyStore;
  readonly rootCertificate?: Uint8Array;
}

const MAX_APP_BODY_BYTES = 64 * 1024;

function appJson(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function refusal(code: string, status: number): Response {
  return appJson({ code }, status);
}

function allowedAppIds(env: AppGatewayEnvironment): readonly string[] {
  return (env.TRIPCHECK_APP_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function allowedEnvironments(env: AppGatewayEnvironment): readonly AttestEnvironment[] {
  const raw = env.TRIPCHECK_APP_ATTEST_ENVIRONMENTS?.trim();
  if (!raw) return ["production"];
  const values = raw.split(",").map((value) => value.trim()).filter((value) => value.length > 0);
  return values.filter((value): value is AttestEnvironment => value === "development" || value === "production");
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return null;
  }
  if (rawBody.byteLength > MAX_APP_BODY_BYTES) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      return decoded as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

function stringField(body: Record<string, unknown>, name: string, maximum: number): string | null {
  const value = body[name];
  return typeof value === "string" && value.length >= 1 && value.length <= maximum ? value : null;
}

export async function handleAppGateway(
  request: Request,
  env: AppGatewayEnvironment,
  deps: AppGatewayDependencies = {},
): Promise<Response> {
  if (env.TRIPCHECK_APP_API_DISABLED?.trim()) return refusal("disabled", 503);
  const pathname = new URL(request.url).pathname;
  const route = APP_GATEWAY_ROUTES.find((candidate) => candidate.path === pathname);
  if (!route) return refusal("not_found", 404);
  if (route.method !== request.method) return refusal("method_not_allowed", 405);

  const nowSeconds = deps.nowSeconds ?? Math.floor(Date.now() / 1000);
  const keyStore = deps.keyStore
    ?? (env.DB && typeof env.DB.prepare === "function" ? d1AppAttestKeyStore(env.DB) : processLocalAppAttestKeyStore());

  if (route.path === "/api/app/challenge") {
    const challenge = await issueChallenge(env, nowSeconds, (deps.nonceHex ?? (() => randomHex(16)))());
    if (!challenge) return refusal("no_signing_secret", 503);
    return appJson({ challenge }, 200);
  }

  if (route.path === "/api/app/ping") {
    const token = request.headers.get(APP_SESSION_HEADER) ?? "";
    if (token.length === 0 || token.length > 512) return refusal("session_invalid", 401);
    const verdict = await verifySession(env, token, nowSeconds);
    if (!verdict.ok) return refusal(verdict.code, verdict.code === "no_signing_secret" ? 503 : 401);
    return appJson({ ok: true, expiresAt: verdict.expiresAt }, 200);
  }

  const body = await readJsonBody(request);
  if (!body) return refusal("bad_request", 400);
  const challenge = stringField(body, "challenge", 256);
  if (!challenge) return refusal("bad_request", 400);
  const challengeVerdict = await verifyChallenge(env, challenge, nowSeconds);
  if (!challengeVerdict.ok) {
    return refusal(challengeVerdict.code, challengeVerdict.code === "no_signing_secret" ? 503 : 401);
  }

  if (route.path === "/api/app/attest") {
    const bypassToken = stringField(body, "bypassToken", 128);
    if (bypassToken !== null) {
      const expected = env.TRIPCHECK_APP_ATTEST_BYPASS_TOKEN?.trim();
      if (!expected || bypassToken !== expected) return refusal("bypass_disabled", 401);
      const issued = await issueSession(env, BYPASS_KEY_ID, nowSeconds);
      if (!issued) return refusal("no_signing_secret", 503);
      return appJson({ session: issued.session, expiresAt: issued.expiresAt }, 200);
    }

    const keyId = stringField(body, "keyId", 64);
    const attestation = stringField(body, "attestation", 32_768);
    if (!keyId || !attestation) return refusal("bad_request", 400);
    const appIds = allowedAppIds(env);
    if (appIds.length === 0) return refusal("app_id_mismatch", 401);
    const verdict = await verifyAttestation({
      keyId,
      attestation,
      challenge,
      appIds,
      environments: allowedEnvironments(env),
      rootCertificate: deps.rootCertificate ?? appleAppAttestRootDer(),
      nowSeconds,
    });
    if (!verdict.ok) return refusal(verdict.code, 401);
    const timestamp = new Date(nowSeconds * 1000).toISOString();
    await keyStore.register({
      keyId: verdict.keyId,
      publicKey: verdict.publicKey,
      counter: 0,
      environment: verdict.environment,
      appId: verdict.appId,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    });
    const issued = await issueSession(env, verdict.keyId, nowSeconds);
    if (!issued) return refusal("no_signing_secret", 503);
    return appJson({ session: issued.session, expiresAt: issued.expiresAt }, 200);
  }

  // POST /api/app/assert
  const rawKeyId = stringField(body, "keyId", 64);
  const assertion = stringField(body, "assertion", 8_192);
  if (!rawKeyId || !assertion) return refusal("bad_request", 400);
  const keyIdBytes = base64ToBytes(rawKeyId);
  if (!keyIdBytes) return refusal("bad_request", 400);
  const keyId = bytesToBase64Url(keyIdBytes);
  const record = await keyStore.get(keyId);
  if (!record) return refusal("unknown_key", 401);

  const publicKeyPoint = base64ToBytes(record.publicKey);
  if (!publicKeyPoint) return refusal("unknown_key", 401);
  const verdict = await verifyAssertion({
    assertion,
    challenge,
    publicKeyPoint,
    appId: record.appId,
    storedCounter: record.counter,
  });
  if (!verdict.ok) return refusal(verdict.code, 401);
  await keyStore.advanceCounter(keyId, verdict.counter, new Date(nowSeconds * 1000).toISOString());
  const issued = await issueSession(env, keyId, nowSeconds);
  if (!issued) return refusal("no_signing_secret", 503);
  return appJson({ session: issued.session, expiresAt: issued.expiresAt }, 200);
}
