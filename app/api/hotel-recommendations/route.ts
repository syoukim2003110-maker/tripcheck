import { fetchGoogleHotelCandidates, parseHotelSearchRequest } from "../../../lib/google-hotels";
import { fetchRakutenHotelFacts, matchRakutenFact } from "../../../lib/rakuten-hotels";

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
  const parsed = parseHotelSearchRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  try {
    let candidates = await fetchGoogleHotelCandidates(parsed, apiKey);
    // Optional price/review evidence from Rakuten Travel. Its absence or
    // failure never hides the Google candidates.
    const rakutenApplicationId = process.env.RAKUTEN_APPLICATION_ID ?? process.env.RAKUTEN_APP_ID;
    const rakutenAccessKey = process.env.RAKUTEN_ACCESS_KEY;
    if (rakutenApplicationId && rakutenAccessKey) {
      try {
        const facts = await fetchRakutenHotelFacts(parsed.latitude, parsed.longitude, rakutenApplicationId, rakutenAccessKey);
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
      } catch { /* evidence stays Google-only */ }
    }
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      candidates,
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
