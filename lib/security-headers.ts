/**
 * Browser-visible providers stay on an explicit host allowlist. Google powers
 * configured paid maps of the old planner; the booklet's map is Apple's
 * (MapKit JS, below). Everything else remains behind same-origin `/api/`
 * routes or the site's own Apple relay.
 */
const GOOGLE_MAPS_HOSTS = [
  "https://*.googleapis.com",
  "https://*.gstatic.com",
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
  // The way along the streets for a leg Apple could not route, or when the Apple map is not shown.
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
 * Apple's MapKit JS: the booklet's map, and Apple's place card (opening
 * hours, phone, website) in an opened stop. One script serves both, fetched
 * once the booklet is on screen. Each list holds only what was seen to be
 * needed when the page ran under this very policy (as a meta tag, served
 * from localhost through the dev relay, 2026-11-18):
 * - script-src cdn: mapkit.js itself.
 * - connect-src cdn: start-up call, strings, and the map's vector tiles,
 *   icons and road shields (/md/v1/…, /ti/tile), fetched by the script;
 *   api: the place card's place lookup.
 * - img-src cdn: Apple's logo on the map (/mk/<version>/images/logos/…),
 *   which must stay visible. Nothing else of the map is an <img>.
 *   img-src snapshot: each printed day's Apple map, a Maps Web Snapshot
 *   image whose URL the relay signs (op=snapshot) when the booklet is
 *   printed (seen under this policy, 2026-11-19).
 * - frame-src cdn: the frame Apple draws the place card in; the card's own
 *   images and fonts load inside it.
 * MapKit's tile worker runs from a blob: URL (worker-src blob:), so no worker
 * host is listed. Apple's usage report from the page
 * (gsp10.apple-mapkit.com/mw/v1/reportAnalytics) is left blocked on purpose:
 * the map and the card work without it.
 */
const APPLE_MAPKIT_SCRIPT_HOSTS = ["https://cdn.apple-mapkit.com"] as const;
const APPLE_MAPKIT_CONNECT_HOSTS = ["https://cdn.apple-mapkit.com", "https://api.apple-mapkit.com"] as const;
const APPLE_MAPKIT_IMAGE_HOSTS = ["https://cdn.apple-mapkit.com", "https://snapshot.apple-mapkit.com"] as const;
const APPLE_MAPKIT_FRAME_HOSTS = ["https://cdn.apple-mapkit.com"] as const;

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
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${GOOGLE_MAPS_HOSTS.join(" ")} ${APPLE_MAPKIT_SCRIPT_HOSTS.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Was `https:`, which let anything that got script onto the page exfiltrate
  // an itinerary through an <img src>.
  `img-src 'self' data: blob: ${GOOGLE_IMAGE_HOSTS.join(" ")} ${SIGHT_PHOTO_HOSTS.join(" ")} ${APPLE_MAPKIT_IMAGE_HOSTS.join(" ")}`,
  // Was `https: wss:`. Every fetch the app makes is same-origin; the rest is
  // the Maps runtime's own tile and metadata traffic. There are no websockets
  // in production — that allowance existed for local HMR, which never sees
  // this policy.
  `connect-src 'self' data: blob: ${GOOGLE_MAPS_HOSTS.join(" ")} ${[...OPEN_PLACE_DATA_HOSTS, ...APPLE_MAPKIT_CONNECT_HOSTS].join(" ")}`,
  "worker-src 'self' blob:",
  `frame-src ${["'self'", "https://www.google.com", "https://maps.google.com", ...APPLE_MAPKIT_FRAME_HOSTS].join(" ")}`,
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
