/**
 * Signatures for Places Photo names.
 *
 * `GET /api/place-photo` spends a metered Google key, but it is reached by an
 * `<img src>`, which can carry neither an `Origin` header nor a custom one. It
 * therefore cannot use the same-origin gate every other paid route passes, and
 * for a while it had no gate at all: a client that simply omitted
 * `Sec-Fetch-Site` walked past the one check and bought a Places Photo event.
 *
 * The resource authorises itself instead. Whenever the server hands a photo
 * name to the browser it also hands over a short-lived signature of that exact
 * name, and the photo route serves nothing it did not sign. The signature is
 * not a substitute for the durable quota — the Worker still reserves a unit per
 * photo — it just means a forged or guessed name never reaches Google at all.
 */

export const PLACE_PHOTO_TOKEN_VERSION = "v1";

/**
 * One hour. The remediation spec proposed five minutes; a planning session
 * routinely stays open longer than that, and an expired signature would make
 * already-rendered cards lose their photos mid-session. The signature only ever
 * authorises one quota-metered fetch of one already-issued photo name, so the
 * longer window costs nothing that the ceilings do not already bound.
 */
export const PLACE_PHOTO_TOKEN_TTL_SECONDS = 3_600;

export const PLACE_PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]{8,300}\/photos\/[A-Za-z0-9_-]{8,600}$/;
const TOKEN_PATTERN = /^(\d{10,13})\.([A-Za-z0-9_-]{43})$/;

export type PlacePhotoTokenEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Key material, in preference order. Every candidate is a server-only secret
 * that already has to be present for this route to function, so signing never
 * needs new configuration and can never silently fall back to "unsigned".
 */
export function placePhotoTokenSecret(env: PlacePhotoTokenEnvironment): string | null {
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

async function signature(secret: string, payload: string) {
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

/** `<expiry seconds>.<base64url HMAC>` — opaque to the client. */
export async function signPlacePhotoName(
  photoName: string,
  secret: string,
  expiresAtSeconds: number,
): Promise<string | null> {
  if (!PLACE_PHOTO_NAME_PATTERN.test(photoName)) return null;
  const expiry = Math.floor(expiresAtSeconds);
  if (!Number.isSafeInteger(expiry) || expiry <= 0) return null;
  return `${expiry}.${await signature(secret, `${PLACE_PHOTO_TOKEN_VERSION}\n${expiry}\n${photoName}`)}`;
}

/** Length-independent comparison; both operands are fixed-length base64url. */
function equalSignatures(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyPlacePhotoToken(input: {
  photoName: string;
  token: string;
  secret: string;
  nowSeconds: number;
}): Promise<boolean> {
  if (!PLACE_PHOTO_NAME_PATTERN.test(input.photoName)) return false;
  const parts = TOKEN_PATTERN.exec(input.token);
  if (!parts) return false;
  const expiry = Number(parts[1]);
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(input.nowSeconds)) return false;
  // A far-future expiry would be an unbounded grant even with a valid MAC.
  if (expiry > Math.floor(input.nowSeconds) + PLACE_PHOTO_TOKEN_TTL_SECONDS) return false;
  const expected = await signature(input.secret, `${PLACE_PHOTO_TOKEN_VERSION}\n${expiry}\n${input.photoName}`);
  return equalSignatures(expected, parts[2]);
}

/**
 * Mints the signature the browser needs for one photo name. Returns null when
 * the deployment has no usable secret, which leaves the card without a photo
 * rather than issuing an unsigned URL the photo route will refuse anyway.
 */
export async function mintPlacePhotoSignature(
  photoName: string | null | undefined,
  env: PlacePhotoTokenEnvironment,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (!photoName) return null;
  const secret = placePhotoTokenSecret(env);
  if (!secret) return null;
  return signPlacePhotoName(photoName, secret, Math.floor(nowMs / 1000) + PLACE_PHOTO_TOKEN_TTL_SECONDS);
}
