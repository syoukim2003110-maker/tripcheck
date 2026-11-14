/**
 * Browser-visible providers stay on an explicit host allowlist. Google powers
 * configured paid maps; the key-free map fetches its public style, glyphs and
 * vector tiles from OpenFreeMap. Everything else remains behind same-origin
 * `/api/` routes.
 */
const GOOGLE_MAPS_HOSTS = [
  "https://*.googleapis.com",
  "https://*.gstatic.com",
] as const;

const OPEN_FREE_MAP_HOSTS = [
  "https://tiles.openfreemap.org",
] as const;

/**
 * The keyless place lookup runs in the page itself, so the page talks to
 * these public data services directly. Place names and an approximate trip
 * area go there; itinerary text does not.
 */
export const OPEN_PLACE_DATA_HOSTS = [
  "https://*.wikipedia.org",
  "https://www.wikidata.org",
  "https://query.wikidata.org",
  "https://photon.komoot.io",
  "https://nominatim.openstreetmap.org",
  // The way along the streets for a leg Apple could not route.
  "https://routing.openstreetmap.de",
  // Forecast and public holidays for the trip's own dates, asked for directly
  // when the site is hosted as static files.
  "https://api.open-meteo.com",
  "https://date.nager.at",
] as const;

/**
 * Sight photos on the booklet's cards are Wikimedia Commons thumbnails. The
 * file path on commons.wikimedia.org redirects to whichever host Wikimedia
 * serves thumbnails from — upload.wikimedia.org for years, then
 * thumb.wikimedia.org without notice, which blanked every photo under a
 * policy that named the hosts one by one. The foundation's own domain is the
 * boundary that holds.
 */
const SIGHT_PHOTO_HOSTS = [
  "https://*.wikimedia.org",
  // Restaurant photos, shown with the provider's credit (HotPepper Gourmet).
  "https://imgfp.hotp.jp",
] as const;

/**
 * Apple's place card (opening hours, phone, website) in an opened stop of the
 * booklet. Its script is fetched only when a traveller asks for a card. Each
 * list holds only what the card was seen to need under this policy: the
 * script, its strings and start-up call (cdn) and the place lookup (api),
 * and the frame Apple draws the card in. Its images and fonts load inside
 * that frame, so img-src and font-src stay as they were. Apple's usage
 * report from the page (gsp10.apple-mapkit.com) is left blocked on purpose:
 * the card works without it.
 */
const APPLE_PLACE_CARD_SCRIPT_HOSTS = ["https://cdn.apple-mapkit.com"] as const;
const APPLE_PLACE_CARD_CONNECT_HOSTS = ["https://cdn.apple-mapkit.com", "https://api.apple-mapkit.com"] as const;
const APPLE_PLACE_CARD_FRAME_HOSTS = ["https://cdn.apple-mapkit.com"] as const;

/** Tiles, markers, Street View and the photo redirect's destination. */
const GOOGLE_IMAGE_HOSTS = [
  ...GOOGLE_MAPS_HOSTS,
  "https://*.google.com",
  "https://*.googleusercontent.com",
  "https://*.ggpht.com",
] as const;

export const productionContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 'unsafe-inline' is not removable while the framework emits its RSC
  // bootstrap as inline <script> with no nonce, and a nonce would be ignored
  // beside it anyway. 'unsafe-eval' belongs to the Maps runtime; narrowing it
  // to 'wasm-unsafe-eval' is the next step and needs a staged rollout with
  // report-only collection, because a wrong guess breaks the map in
  // production and the QA harness cannot load Maps to tell us.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${GOOGLE_MAPS_HOSTS.join(" ")} ${APPLE_PLACE_CARD_SCRIPT_HOSTS.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Was `https:`, which let anything that got script onto the page exfiltrate
  // an itinerary through an <img src>.
  `img-src 'self' data: blob: ${GOOGLE_IMAGE_HOSTS.join(" ")} ${SIGHT_PHOTO_HOSTS.join(" ")}`,
  // Was `https: wss:`. Every fetch the app makes is same-origin; the rest is
  // the Maps runtime's own tile and metadata traffic. There are no websockets
  // in production — that allowance existed for local HMR, which never sees
  // this policy.
  `connect-src 'self' data: blob: ${GOOGLE_MAPS_HOSTS.join(" ")} ${OPEN_FREE_MAP_HOSTS.join(" ")} ${[...OPEN_PLACE_DATA_HOSTS, ...APPLE_PLACE_CARD_CONNECT_HOSTS].join(" ")}`,
  "worker-src 'self' blob:",
  `frame-src ${["'self'", "https://www.google.com", "https://maps.google.com", ...APPLE_PLACE_CARD_FRAME_HOSTS].join(" ")}`,
].join("; ");

function isLocalDevelopment(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

/**
 * Security policy shared by page, API and image responses at the Worker edge.
 * CSP is intentionally skipped on localhost so Vite HMR is not weakened into
 * a production policy full of development-only websocket/eval exceptions.
 */
export function secureResponse(response: Response, requestUrl: string | URL) {
  const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);
  const headers = new Headers(response.headers);
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (!isLocalDevelopment(url)) {
    headers.set("Content-Security-Policy", productionContentSecurityPolicy);
    if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function contentSecurityPolicy() {
  return productionContentSecurityPolicy;
}
