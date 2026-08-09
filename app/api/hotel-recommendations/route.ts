import { destinationById, destinationForCoordinate } from "../../../lib/destinations";
import { fetchGoogleHotelCandidates, parseHotelSearchRequest } from "../../../lib/google-hotels";
import { fetchRakutenHotelFacts, matchRakutenFact } from "../../../lib/rakuten-hotels";
import { nonCoreApiGate } from "../../../lib/server/non-core-api-gate";

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
  const featureGate = nonCoreApiGate("hotel_recommendations");
  if (featureGate) return featureGate;
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
  const parsed = parseHotelSearchRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  try {
    let candidates = await fetchGoogleHotelCandidates(parsed, apiKey);
    // Optional price/review evidence from Rakuten Travel. Its absence or
    // failure never hides the Google candidates. Rakuten only lists Japanese
    // properties, so outside Japan the call is skipped rather than wasted:
    // when the destination is still "auto", the search coordinate decides.
    const destination = parsed.destination === "auto"
      ? destinationForCoordinate(parsed.latitude, parsed.longitude)
      : destinationById(parsed.destination);
    const rakutenApplicationId = process.env.RAKUTEN_APPLICATION_ID ?? process.env.RAKUTEN_APP_ID;
    const rakutenAccessKey = process.env.RAKUTEN_ACCESS_KEY;
    // Whether the optional provider actually answered, so the UI can say
    // "price evidence unavailable" instead of leaving every price blank as if
    // no listing existed. An empty successful result still counts as available.
    let rakutenAvailable = false;
    if (destination?.hotelFacts === "rakuten" && rakutenApplicationId && rakutenAccessKey) {
      try {
        const facts = await fetchRakutenHotelFacts(parsed.latitude, parsed.longitude, rakutenApplicationId, rakutenAccessKey);
        rakutenAvailable = true;
        candidates = candidates.map((candidate) => {
          const fact = matchRakutenFact(candidate, facts);
          return fact ? {
            ...candidate,
            rakuten: {
              minCharge: fact.minCharge,
              reviewAverage: fact.reviewAverage,
              reviewCount: fact.reviewCount,
              url: fact.url,
            },
          } : candidate;
        });
      } catch {
        // Evidence stays Google-only. The bounded code (never the error body,
        // which can carry key material) is logged so an IP-allowlist change is
        // discoverable in server logs instead of silently eating prices.
        console.warn("rakuten_optional_unavailable");
      }
    }
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      evidenceProviders: { rakuten: rakutenAvailable },
      candidates,
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
