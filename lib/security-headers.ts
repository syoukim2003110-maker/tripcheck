/**
 * Google Maps JavaScript API is the only third party the browser talks to.
 * Everything else the app fetches is a same-origin `/api/` route, including
 * Places photos and link-preview thumbnails, which are proxied precisely so
 * this list can stay closed.
 */
const GOOGLE_MAPS_HOSTS = [
  "https://*.googleapis.com",
  "https://*.gstatic.com",
] as const;

/** Tiles, markers, Street View and the photo redirect's destination. */
const GOOGLE_IMAGE_HOSTS = [
  ...GOOGLE_MAPS_HOSTS,
  "https://*.google.com",
  "https://*.googleusercontent.com",
  "https://*.ggpht.com",
] as const;

const productionContentSecurityPolicy = [
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
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${GOOGLE_MAPS_HOSTS.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Was `https:`, which let anything that got script onto the page exfiltrate
  // an itinerary through an <img src>.
  `img-src 'self' data: blob: ${GOOGLE_IMAGE_HOSTS.join(" ")}`,
  // Was `https: wss:`. Every fetch the app makes is same-origin; the rest is
  // the Maps runtime's own tile and metadata traffic. There are no websockets
  // in production — that allowance existed for local HMR, which never sees
  // this policy.
  `connect-src 'self' data: blob: ${GOOGLE_MAPS_HOSTS.join(" ")}`,
  "worker-src 'self' blob:",
  "frame-src 'self' https://www.google.com https://maps.google.com",
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
