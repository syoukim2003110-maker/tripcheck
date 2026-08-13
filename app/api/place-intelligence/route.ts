import { fetchPlaceIntelligence, parsePlaceIntelligenceRequest } from "../../../lib/place-intelligence";
import { paidApiDenialResponse, paidProviderGateway } from "../../../lib/server/provider-gateway";
import { providerFetchWithParentSignal } from "../../../lib/server/provider-resilience";
import { signPlacePhotoNames } from "../../../lib/server/sign-place-photos";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const preflight = paidProviderGateway.preflight(request, "google");
  if (!preflight.ok) return paidApiDenialResponse(preflight, noStoreHeaders);
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
  const access = paidProviderGateway.reserve(preflight, "place_intelligence", 1);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);

  try {
    // Google evidence is organized by deterministic rules. Claude is reserved for the
    // separate, explicit public-web search so this fast path stays cheap and reproducible.
    const result = await fetchPlaceIntelligence(
      parsed,
      placesApiKey,
      null,
      providerFetchWithParentSignal(request.signal),
    );
    access.complete();
    return Response.json(await signPlacePhotoNames(result), { headers: { ...noStoreHeaders, ...access.headers } });
  } catch {
    access.complete({ failedUnits: 1 });
    return Response.json({ code: "unavailable" }, { status: 502, headers: { ...noStoreHeaders, ...access.headers } });
  }
}
