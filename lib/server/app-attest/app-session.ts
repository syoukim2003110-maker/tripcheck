/**
 * Challenges and app-session tokens for the App Attest gateway. Both are
 * stateless: a version-prefixed payload signed with the server's existing
 * signing-secret chain, so no new configuration and nothing stored.
 */

import { equalSignatures, hmacBase64Url, signingSecret, type SigningEnvironment } from "../hmac-signature.ts";

const CHALLENGE_DOMAIN = "tc-app-challenge-v1";
const SESSION_DOMAIN = "tc-app-session-v1";

export const CHALLENGE_TTL_SECONDS = 300;
export const CHALLENGE_LEEWAY_SECONDS = 60;
export const SESSION_TTL_SECONDS = 86_400;

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export type ChallengeVerdict =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "challenge_invalid" | "challenge_expired" | "no_signing_secret" }>;

export type SessionVerdict =
  | Readonly<{ ok: true; keyId: string; expiresAt: number }>
  | Readonly<{ ok: false; code: "session_invalid" | "session_expired" | "no_signing_secret" }>;

export async function issueChallenge(
  env: SigningEnvironment,
  nowSeconds: number,
  nonceHex: string,
): Promise<string | null> {
  const secret = signingSecret(env);
  if (!secret) return null;
  const issuedAt = String(nowSeconds);
  const signature = await hmacBase64Url(secret, [CHALLENGE_DOMAIN, issuedAt, nonceHex].join("\n"));
  return `v1.${issuedAt}.${nonceHex}.${signature}`;
}

export async function verifyChallenge(
  env: SigningEnvironment,
  challenge: string,
  nowSeconds: number,
): Promise<ChallengeVerdict> {
  const secret = signingSecret(env);
  if (!secret) return { ok: false, code: "no_signing_secret" };
  const parts = challenge.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return { ok: false, code: "challenge_invalid" };
  const [, issuedAtText, nonceHex, signature] = parts;
  if (!/^\d{1,12}$/.test(issuedAtText) || !NONCE_PATTERN.test(nonceHex)) {
    return { ok: false, code: "challenge_invalid" };
  }
  const expected = await hmacBase64Url(secret, [CHALLENGE_DOMAIN, issuedAtText, nonceHex].join("\n"));
  if (!equalSignatures(signature, expected)) return { ok: false, code: "challenge_invalid" };
  const issuedAt = Number(issuedAtText);
  if (nowSeconds < issuedAt - CHALLENGE_LEEWAY_SECONDS) return { ok: false, code: "challenge_invalid" };
  if (nowSeconds > issuedAt + CHALLENGE_TTL_SECONDS) return { ok: false, code: "challenge_expired" };
  return { ok: true };
}

export async function issueSession(
  env: SigningEnvironment,
  keyId: string,
  nowSeconds: number,
): Promise<Readonly<{ session: string; expiresAt: number }> | null> {
  const secret = signingSecret(env);
  if (!secret || !KEY_ID_PATTERN.test(keyId)) return null;
  const expiresAt = nowSeconds + SESSION_TTL_SECONDS;
  const payload = [SESSION_DOMAIN, keyId, String(nowSeconds), String(expiresAt)].join("\n");
  const signature = await hmacBase64Url(secret, payload);
  return { session: `v1.${keyId}.${nowSeconds}.${expiresAt}.${signature}`, expiresAt };
}

export async function verifySession(
  env: SigningEnvironment,
  token: string,
  nowSeconds: number,
): Promise<SessionVerdict> {
  const secret = signingSecret(env);
  if (!secret) return { ok: false, code: "no_signing_secret" };
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return { ok: false, code: "session_invalid" };
  const [, keyId, issuedAtText, expiresAtText, signature] = parts;
  if (!KEY_ID_PATTERN.test(keyId) || !/^\d{1,12}$/.test(issuedAtText) || !/^\d{1,12}$/.test(expiresAtText)) {
    return { ok: false, code: "session_invalid" };
  }
  const payload = [SESSION_DOMAIN, keyId, issuedAtText, expiresAtText].join("\n");
  const expected = await hmacBase64Url(secret, payload);
  if (!equalSignatures(signature, expected)) return { ok: false, code: "session_invalid" };
  const issuedAt = Number(issuedAtText);
  const expiresAt = Number(expiresAtText);
  if (expiresAt - issuedAt !== SESSION_TTL_SECONDS || nowSeconds < issuedAt - CHALLENGE_LEEWAY_SECONDS) {
    return { ok: false, code: "session_invalid" };
  }
  if (nowSeconds >= expiresAt) return { ok: false, code: "session_expired" };
  return { ok: true, keyId, expiresAt };
}
