import { fetchGooglePlaceResolutions, parsePlaceResolutionRequest } from "../../../lib/google-place-resolver";
import { paidApiDenialResponse, paidProviderGateway } from "../../../lib/server/provider-gateway";
import { providerFetchWithParentSignal } from "../../../lib/server/provider-resilience";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

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
  const parsed = parsePlaceResolutionRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  const providerEvents = parsed.queries.length + parsed.providerOverrides.length + (parsed.hotelQuery ? 1 : 0);
  const access = paidProviderGateway.reserve(preflight, "place_resolution", providerEvents);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);

  try {
    const result = await fetchGooglePlaceResolutions(parsed, apiKey, providerFetchWithParentSignal(request.signal));
    access.complete();
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      ...result,
    }, { headers: { ...noStoreHeaders, ...access.headers } });
  } catch {
    access.complete({ failedUnits: providerEvents });
    return Response.json({ code: "unavailable" }, { status: 502, headers: { ...noStoreHeaders, ...access.headers } });
  }
}
