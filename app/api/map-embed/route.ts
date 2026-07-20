import { buildGoogleMapEmbedUrl, parseMapEmbedRequest } from "../../../lib/google-map-embed";

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_MAPS_BROWSER_API_KEY;
  if (!apiKey) return new Response("Map is not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
  const parsed = parseMapEmbedRequest(request.url);
  if (!parsed) return new Response("Invalid map request", { status: 400, headers: { "Cache-Control": "no-store" } });
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildGoogleMapEmbedUrl(parsed, apiKey),
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
