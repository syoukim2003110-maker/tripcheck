const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const photoNamePattern = /^places\/[A-Za-z0-9_-]{8,300}\/photos\/[A-Za-z0-9_-]{8,600}$/;

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return new Response("Photo service is not configured", { status: 503, headers: noStoreHeaders });

  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
  if (!photoNamePattern.test(name)) return new Response("Invalid photo", { status: 400, headers: noStoreHeaders });

  try {
    const params = new URLSearchParams({
      key: apiKey,
      maxHeightPx: "560",
      maxWidthPx: "900",
      skipHttpRedirect: "true",
    });
    const response = await fetch(`https://places.googleapis.com/v1/${name}/media?${params.toString()}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error("photo_unavailable");
    const payload = await response.json() as { photoUri?: string };
    if (!payload.photoUri || !payload.photoUri.startsWith("https://")) throw new Error("photo_unavailable");
    return new Response(null, { status: 302, headers: { ...noStoreHeaders, Location: payload.photoUri } });
  } catch {
    return new Response("Photo unavailable", { status: 502, headers: noStoreHeaders });
  }
}
