import { mintPlacePhotoSignature, PLACE_PHOTO_NAME_PATTERN } from "./place-photo-token.ts";

/**
 * Signs every Places Photo name in an outgoing API payload.
 *
 * The photo name is produced deep inside four synchronous parsers, so the
 * signature is attached once at the route boundary instead — one pass, one
 * place to audit, and no parser has to become async to buy a photo.
 *
 * It walks arrays and plain objects, signs `photoName` into `photoSignature`
 * and `photo.name` into `photo.signature`, and leaves everything else alone.
 * Names that do not match the Places Photo shape get no signature, so the
 * photo route refuses them.
 */
export async function signPlacePhotoNames<T>(
  payload: T,
  env: Readonly<Record<string, string | undefined>> = process.env as Record<string, string | undefined>,
  nowMs: number = Date.now(),
): Promise<T> {
  const pending: Promise<void>[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    const record = node as Record<string, unknown>;
    const photoName = record.photoName;
    if (typeof photoName === "string" && PLACE_PHOTO_NAME_PATTERN.test(photoName)) {
      pending.push(mintPlacePhotoSignature(photoName, env, nowMs).then((signature) => {
        record.photoSignature = signature;
      }));
    }
    const name = record.name;
    if (typeof name === "string" && PLACE_PHOTO_NAME_PATTERN.test(name)) {
      pending.push(mintPlacePhotoSignature(name, env, nowMs).then((signature) => {
        record.signature = signature;
      }));
    }
    for (const value of Object.values(record)) visit(value);
  };

  visit(payload);
  await Promise.all(pending);
  return payload;
}
