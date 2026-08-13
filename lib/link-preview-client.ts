import type { LinkPreview } from "./link-preview.ts";

export class LinkPreviewError extends Error {}

export async function requestLinkPreview(url: string, signature: string): Promise<LinkPreview> {
  let response: Response;
  try {
    response = await fetch("/api/link-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, sig: signature }),
    });
  } catch {
    throw new LinkPreviewError("unavailable");
  }
  const payload = await response.json().catch(() => null) as (LinkPreview & { code?: string }) | null;
  if (!response.ok || !payload) throw new LinkPreviewError(payload?.code ?? "unavailable");
  return payload;
}
