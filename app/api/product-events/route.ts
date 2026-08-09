import { parseProductEvent } from "../../../lib/product-analytics.ts";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_EVENT_BYTES = 4_096;

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLocaleLowerCase("en-US") ?? null;
  const configured = process.env.TRIPCHECK_PUBLIC_ORIGIN?.trim();
  let expected: string;
  try {
    expected = new URL(configured || request.url).origin;
  } catch {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    if (!origin || fetchSite !== "same-origin") return false;
    try { return new URL(origin).origin === expected; } catch { return false; }
  }
  if (!origin) return fetchSite !== "cross-site";
  try { return new URL(origin).origin === expected && fetchSite !== "cross-site"; } catch { return false; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EVENT_BYTES) {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const event = parseProductEvent(body);
  if (!event || JSON.stringify(event).length > MAX_EVENT_BYTES) {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }

  // Structured platform logs receive only the closed aggregate schema above.
  // No itinerary, POI, hotel, address, date, booking time or stable user ID is
  // accepted or emitted here.
  console.info("tripcheck_product_event", JSON.stringify({ ...event, receivedAt: new Date().toISOString() }));
  return new Response(null, { status: 202, headers: noStoreHeaders });
}
