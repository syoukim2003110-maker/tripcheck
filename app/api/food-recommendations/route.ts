import { fetchGoogleFoodCandidates, parseFoodSearchRequest } from "../../../lib/google-food";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseFoodSearchRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  try {
    const candidates = await fetchGoogleFoodCandidates(parsed, apiKey);
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      candidates,
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
