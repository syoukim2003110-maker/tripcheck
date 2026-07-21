import { fetchGooglePlaceResolutions, parsePlaceResolutionRequest } from "../../../lib/google-place-resolver";

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
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parsePlaceResolutionRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  try {
    const result = await fetchGooglePlaceResolutions(parsed, apiKey);
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      ...result,
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
