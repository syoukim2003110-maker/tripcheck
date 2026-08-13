import { fetchGooglePlaceSuggestions, parsePlaceSuggestionRequest } from "../../../lib/google-place-suggestions";
import { paidApiDenialResponse, paidProviderGateway } from "../../../lib/server/provider-gateway";
import { providerFetchWithParentSignal } from "../../../lib/server/provider-resilience";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  const preflight = paidProviderGateway.preflight(request, "google");
  if (!preflight.ok) return paidApiDenialResponse(preflight, noStoreHeaders);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parsePlaceSuggestionRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  const access = paidProviderGateway.reserve(preflight, "place_suggestions", 1);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);

  try {
    const suggestions = await fetchGooglePlaceSuggestions(
      parsed,
      apiKey,
      providerFetchWithParentSignal(request.signal),
    );
    access.complete();
    return Response.json({ provider: "google_maps", suggestions }, {
      headers: { ...noStoreHeaders, ...access.headers },
    });
  } catch {
    access.complete({ failedUnits: 1 });
    return Response.json({ code: "unavailable" }, {
      status: 502,
      headers: { ...noStoreHeaders, ...access.headers },
    });
  }
}
