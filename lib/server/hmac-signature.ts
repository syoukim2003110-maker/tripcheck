/**
 * The one HMAC-SHA256 implementation behind every "the server issued this"
 * signature at the edge. Web Crypto, so it is the same code in the Worker and
 * under `node --test`.
 *
 * Every caller signs a version-prefixed, newline-joined payload. The prefix is
 * the domain separator: a signature minted for one kind of resource must never
 * verify as another, however similar the values look.
 */

export type SigningEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Key material, in preference order. Every candidate is a server-only secret
 * that already has to be present for the routes that use it, so signing never
 * needs new configuration and can never silently fall back to "unsigned".
 */
export function signingSecret(env: SigningEnvironment): string | null {
  for (const name of ["TRIPCHECK_PHOTO_TOKEN_SECRET", "TRIPCHECK_QUOTA_HASH_SECRET", "GOOGLE_PLACES_API_KEY"]) {
    const value = env[name]?.trim();
    if (value && value.length >= 16) return value;
  }
  return null;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function hmacBase64Url(secret: string, payload: string) {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signed));
}

/** Length-independent comparison; both operands are fixed-length base64url. */
export function equalSignatures(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** `<expiry seconds>.<43-char base64url HMAC>` — opaque to the client. */
export const SIGNED_TOKEN_PATTERN = /^(\d{10,13})\.([A-Za-z0-9_-]{43})$/;
