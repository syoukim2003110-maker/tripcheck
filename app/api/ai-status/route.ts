import { enabledAnthropicApiKey } from "../../../lib/anthropic-runtime";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

/* The client hides paused AI surfaces (social reality checks) instead of
 * letting them fail. Exposes a single boolean, never the key. */
export async function GET() {
  return Response.json({ enabled: enabledAnthropicApiKey() !== null }, { headers: noStoreHeaders });
}
