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

/**
 * The one place a link-preview thumbnail URL is written.
 *
 * The thumbnail comes from an og:image on a third-party host. Pointing an
 * `<img>` straight at it told that host the traveller was reading about this
 * place, and forced `img-src https:` — which is an exfiltration channel for
 * anything that gets script onto the page. It is served through this origin
 * instead, and only with the signature the server minted for that exact URL.
 */
export function linkImageSrc(imageUrl: string | null | undefined, signature: string | null | undefined) {
  if (!imageUrl || !signature) return undefined;
  return `/api/link-image?url=${encodeURIComponent(imageUrl)}&sig=${encodeURIComponent(signature)}`;
}
