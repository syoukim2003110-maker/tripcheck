import {
  assertPublicNetworkTarget,
  parsePublicHttpsUrl,
  resolvePublicHostAddresses,
} from "../../../lib/server/public-url-policy";
import {
  externalUrlTokenSecret,
  verifyExternalUrlToken,
} from "../../../lib/server/external-url-token";

/**
 * The thumbnail from a link preview, served from this origin.
 *
 * It used to be an `<img src>` pointing straight at whatever host the og:image
 * named. That told a third party the traveller was reading about that place —
 * an IP, a timestamp and a Referer's worth of itinerary, from a host the
 * traveller never chose — and it forced `img-src https:`, which leaves an
 * `<img src="https://…?stolen=data">` exfiltration channel open to any script
 * that gets onto the page.
 *
 * Only a URL this server signed is served, and only if it still resolves to a
 * public address; the bytes are capped and the content type has to be an
 * image, so this cannot be turned into a general proxy.
 */

const MAX_IMAGE_BYTES = 2_000_000;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

const denyHeaders = { "Cache-Control": "no-store, max-age=0" } as const;

function deny(status: number, code: string) {
  return Response.json({ code }, { status, headers: denyHeaders });
}

export async function GET(request: Request) {
  // An <img> sends no Origin, so this leans on Sec-Fetch-Site the way the
  // photo route does; the signature is what actually authorises the fetch.
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return deny(403, "forbidden");

  const requestUrl = new URL(request.url);
  const target = parsePublicHttpsUrl(requestUrl.searchParams.get("url"));
  const signature = requestUrl.searchParams.get("sig") ?? "";
  if (!target || !signature) return deny(400, "invalid_request");

  const secret = externalUrlTokenSecret(process.env as Record<string, string | undefined>);
  if (!secret || !await verifyExternalUrlToken({
    url: target.toString(),
    token: signature,
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  })) {
    return deny(403, "forbidden");
  }

  let response: Response;
  try {
    const checked = await assertPublicNetworkTarget(target, resolvePublicHostAddresses);
    response = await fetch(checked, {
      headers: { "User-Agent": "TripCheck-LinkPreview/1.0", Accept: "image/*" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return deny(502, "unavailable");
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!response.ok || !ALLOWED_TYPES.includes(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    return deny(502, "unavailable");
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return deny(502, "too_large");
  }

  // Content-Length is the sender's claim, so the real bytes are counted too.
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) return deny(502, "too_large");

  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, max-age=900",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
