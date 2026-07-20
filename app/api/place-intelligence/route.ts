import { fetchPlaceIntelligence, parsePlaceIntelligenceRequest } from "../../../lib/place-intelligence";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesApiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parsePlaceIntelligenceRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  try {
    const result = await fetchPlaceIntelligence(parsed, placesApiKey, process.env.ANTHROPIC_API_KEY ?? null);
    return Response.json(result, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
