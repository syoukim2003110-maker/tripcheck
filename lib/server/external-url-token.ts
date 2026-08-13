/**
 * Signatures for the external URLs TripCheck itself discovered.
 *
 * `POST /api/link-preview` fetches a URL the client names, and `GET
 * /api/link-image` proxies one. Both were reachable with *any* public https
 * URL, which made them a general-purpose "fetch this for me" service running
 * from the edge. The only defence was a DNS check, and a DNS check has a
 * window: the address verified is not necessarily the address connected to,
 * because the fetch resolves the hostname again.
 *
 * That window cannot be closed on Workers — `fetch` gives no way to pin the
 * connect address for an https request, and connecting to a literal IP breaks
 * SNI. So the aim is taken away instead. The server signs the URLs it hands
 * the browser, and these routes serve nothing else. Rebinding still requires
 * winning a race, but only against a host TripCheck's own web search already
 * surfaced — not against any host an attacker chooses.
 *
 * The version prefix is a domain separator: a Places Photo signature must not
 * verify here, and one of these must not verify as a photo.
 */

import { equalSignatures, hmacBase64Url, SIGNED_TOKEN_PATTERN, signingSecret, type SigningEnvironment } from "./hmac-signature.ts";
import { parsePublicHttpsUrl } from "./public-url-policy.ts";

export const EXTERNAL_URL_TOKEN_VERSION = "ext-v1";

/**
 * One hour, matching the photo signature. A findings list stays on screen for
 * as long as the inspector is open, and an expired signature would turn a
 * source card's preview into an error the traveller cannot act on.
 */
export const EXTERNAL_URL_TOKEN_TTL_SECONDS = 3_600;

export type ExternalUrlEnvironment = SigningEnvironment;

/** @see signingSecret */
export const externalUrlTokenSecret = signingSecret;

/**
 * Only a URL that already passes the outbound policy is signable. Signing
 * anything else would mint a credential for a request the fetch path refuses
 * anyway, and would put the policy in two places.
 */
function signableUrl(value: string): string | null {
  return parsePublicHttpsUrl(value)?.toString() ?? null;
}

export async function signExternalUrl(
  url: string,
  secret: string,
  expiresAtSeconds: number,
): Promise<string | null> {
  const canonical = signableUrl(url);
  if (!canonical) return null;
  const expiry = Math.floor(expiresAtSeconds);
  if (!Number.isSafeInteger(expiry) || expiry <= 0) return null;
  return `${expiry}.${await hmacBase64Url(secret, `${EXTERNAL_URL_TOKEN_VERSION}\n${expiry}\n${canonical}`)}`;
}

export async function verifyExternalUrlToken(input: {
  url: string;
  token: string;
  secret: string;
  nowSeconds: number;
}): Promise<boolean> {
  const canonical = signableUrl(input.url);
  if (!canonical) return false;
  const parts = SIGNED_TOKEN_PATTERN.exec(input.token);
  if (!parts) return false;
  const expiry = Number(parts[1]);
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(input.nowSeconds)) return false;
  // A far-future expiry would be an unbounded grant even with a valid MAC.
  if (expiry > Math.floor(input.nowSeconds) + EXTERNAL_URL_TOKEN_TTL_SECONDS) return false;
  const expected = await hmacBase64Url(input.secret, `${EXTERNAL_URL_TOKEN_VERSION}\n${expiry}\n${canonical}`);
  return equalSignatures(expected, parts[2]);
}

/**
 * Mints the signature the browser needs for one URL. Returns null when the
 * deployment has no usable secret or the URL fails the outbound policy, which
 * leaves the card without a preview rather than issuing a URL the route will
 * refuse anyway.
 */
export async function mintExternalUrlSignature(
  url: string | null | undefined,
  env: ExternalUrlEnvironment,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (!url) return null;
  const secret = externalUrlTokenSecret(env);
  if (!secret) return null;
  return signExternalUrl(url, secret, Math.floor(nowMs / 1000) + EXTERNAL_URL_TOKEN_TTL_SECONDS);
}

/**
 * Signs `findings[].url` on the way out.
 *
 * Returns a signed copy rather than mutating: the fresh-voices route caches
 * its results for half an hour, and a signature written into that cache would
 * be handed out again long after it expired.
 */
export async function signFindingUrls<T extends { findings?: unknown }>(
  result: T,
  env: ExternalUrlEnvironment = process.env as Record<string, string | undefined>,
  nowMs: number = Date.now(),
): Promise<T> {
  if (!Array.isArray(result.findings)) return result;
  const findings = await Promise.all(result.findings.map(async (finding) => {
    if (!finding || typeof finding !== "object") return finding;
    const record = finding as { url?: unknown };
    if (typeof record.url !== "string") return finding;
    return { ...finding, urlSignature: await mintExternalUrlSignature(record.url, env, nowMs) };
  }));
  return { ...result, findings };
}
