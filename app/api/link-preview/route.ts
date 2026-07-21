import { fetchLinkPreview, parsePublicPreviewUrl } from "../../../lib/link-preview";

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
  const url = parsePublicPreviewUrl((body as { url?: unknown } | null)?.url);
  if (!url) return Response.json({ code: "invalid_url" }, { status: 400, headers: noStoreHeaders });
  try {
    return Response.json(await fetchLinkPreview(url), { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
