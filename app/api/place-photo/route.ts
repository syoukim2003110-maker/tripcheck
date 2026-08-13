import {
  PLACE_PHOTO_NAME_PATTERN,
  placePhotoTokenSecret,
  verifyPlacePhotoToken,
} from "../../../lib/server/place-photo-token.ts";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * A paid Google Places Photo fetch, reached by `<img src>`.
 *
 * It cannot use the same-origin header gate the POST routes use, because an
 * image request carries neither `Origin` nor a custom header. It used to lean
 * on `Sec-Fetch-Site !== "cross-site"` alone, which any client that simply
 * sends no headers walks straight past — so the endpoint spent the Places key
 * with no origin check, no quota and no kill switch behind it.
 *
 * Now the resource authorises itself: the server signs each photo name when it
 * hands it to the browser, and nothing unsigned or expired reaches Google. The
 * Worker checks the same signature and reserves a durable quota unit before
 * this handler runs; the check is repeated here so the local dev server and
 * any future direct-origin deployment are gated too.
 */
export async function GET(request: Request) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return new Response("Forbidden", { status: 403, headers: noStoreHeaders });
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return new Response("Photo service is not configured", { status: 503, headers: noStoreHeaders });

  const parameters = new URL(request.url).searchParams;
  const name = parameters.get("name")?.trim() ?? "";
  if (!PLACE_PHOTO_NAME_PATTERN.test(name)) return new Response("Invalid photo", { status: 400, headers: noStoreHeaders });

  const secret = placePhotoTokenSecret(process.env as Record<string, string | undefined>);
  if (!secret) return new Response("Photo service is not configured", { status: 503, headers: noStoreHeaders });
  const authorized = await verifyPlacePhotoToken({
    photoName: name,
    token: parameters.get("sig")?.trim() ?? "",
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!authorized) return new Response("Forbidden", { status: 403, headers: noStoreHeaders });

  try {
    const params = new URLSearchParams({
      key: apiKey,
      maxHeightPx: "560",
      maxWidthPx: "900",
      skipHttpRedirect: "true",
    });
    const response = await fetch(`https://places.googleapis.com/v1/${name}/media?${params.toString()}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error("photo_unavailable");
    const payload = await response.json() as { photoUri?: string };
    if (!payload.photoUri || !payload.photoUri.startsWith("https://")) throw new Error("photo_unavailable");
    return new Response(null, {
      status: 302,
      headers: {
        // The edge relaxes this to a short private cache so re-rendering a
        // card does not buy the same photo twice; a direct-origin deployment
        // keeps the conservative value.
        "Cache-Control": "private, max-age=900",
        "Cross-Origin-Resource-Policy": "same-origin",
        Location: payload.photoUri,
      },
    });
  } catch {
    return new Response("Photo unavailable", { status: 502, headers: noStoreHeaders });
  }
}
