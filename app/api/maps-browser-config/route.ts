const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const key = process.env.GOOGLE_MAPS_BROWSER_API_KEY;
  if (!key) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });
  return Response.json({ key }, { headers: noStoreHeaders });
}
