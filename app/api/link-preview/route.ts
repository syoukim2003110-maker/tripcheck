import { fetchLinkPreview, parsePublicPreviewUrl } from "../../../lib/link-preview";
import {
  externalUrlTokenSecret,
  mintExternalUrlSignature,
  verifyExternalUrlToken,
} from "../../../lib/server/external-url-token";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const payload = body as { url?: unknown; sig?: unknown } | null;
  const url = parsePublicPreviewUrl(payload?.url);
  if (!url) return Response.json({ code: "invalid_url" }, { status: 400, headers: noStoreHeaders });

  // The route fetches whatever it is pointed at, so it only accepts what this
  // server already handed out. Without this the same-origin check alone made
  // it a general fetch service for any public https URL, and the DNS guard
  // below can only narrow the window, never close it.
  const secret = externalUrlTokenSecret(process.env as Record<string, string | undefined>);
  const signature = typeof payload?.sig === "string" ? payload.sig : "";
  if (!secret || !signature || !await verifyExternalUrlToken({
    url: url.toString(),
    token: signature,
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  })) {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }

  try {
    const preview = await fetchLinkPreview(url);
    // The thumbnail is fetched through this origin too, so the browser never
    // contacts the third-party host and the CSP can stay closed.
    return Response.json({
      ...preview,
      imageSignature: await mintExternalUrlSignature(preview.imageUrl, process.env as Record<string, string | undefined>),
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
