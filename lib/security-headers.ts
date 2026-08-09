const productionContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
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
