import { buildGoogleMapEmbedUrl, parseMapEmbedRequest } from "../../../lib/google-map-embed";

/* Keyless environments get a quiet dot-grid canvas instead of an error string
 * so the map pane still reads as an intentional surface. */
const unconfiguredCanvas = `<!doctype html><html><head><meta charset="utf-8"><title>Map is not configured</title><style>
html,body{margin:0;height:100%}
body{background:radial-gradient(rgb(17 17 22 / 8%) 1px, transparent 1.4px) 0 0 / 22px 22px #f2f2f4}
</style></head><body></body></html>`;

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_MAPS_BROWSER_API_KEY;
  if (!apiKey) return new Response(unconfiguredCanvas, { status: 503, headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" } });
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
