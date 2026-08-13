/**
 * The one place a Places Photo URL is written.
 *
 * `/api/place-photo` spends a metered Google key and cannot check an Origin
 * header, because an `<img>` does not send one. It accepts a photo only with
 * the signature the server minted for that exact name, so a card that has no
 * signature has no photo — the `onError` fallback each caller already passes
 * takes over rather than issuing a request the route will refuse.
 */
export function placePhotoSrc(photoName: string | null | undefined, signature: string | null | undefined) {
  if (!photoName || !signature) return undefined;
  return `/api/place-photo?name=${encodeURIComponent(photoName)}&sig=${encodeURIComponent(signature)}`;
}
