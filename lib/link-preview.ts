import {
  assertPublicNetworkTarget,
  parsePublicHttpsUrl,
  resolvePublicHostAddresses,
  type HostAddressResolver,
} from "./server/public-url-policy.ts";

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  imageUrl: string | null;
  siteName: string;
};

export function parsePublicPreviewUrl(value: unknown): URL | null {
  return parsePublicHttpsUrl(value);
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function attributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? "");
  }
  return result;
}

function metaContent(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (keys.includes(key) && attrs.content?.trim()) return attrs.content.trim();
  }
  return "";
}

async function readLimitedText(response: Response, maximumBytes = 700_000) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (received < maximumBytes) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received > maximumBytes) break;
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

export async function fetchLinkPreview(
  input: URL,
  fetcher: typeof fetch = fetch,
  resolver: HostAddressResolver = resolvePublicHostAddresses,
): Promise<LinkPreview> {
  let current = parsePublicPreviewUrl(input.toString());
  if (!current) throw new Error("preview_target");
  let response: Response | null = null;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    current = await assertPublicNetworkTarget(current, resolver);
    response = await fetcher(current, {
      headers: { "User-Agent": "TripCheck-LinkPreview/1.0", Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("preview_redirect");
    await response.body?.cancel().catch(() => undefined);
    const next = parsePublicPreviewUrl(new URL(location, current).toString());
    if (!next) throw new Error("preview_redirect");
    current = next;
  }
  if (!response?.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("preview_unavailable");
  const html = await readLimitedText(response);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
  const title = metaContent(html, ["og:title", "twitter:title"]) || decodeHtml(titleTag) || current.hostname;
  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  const rawImage = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
  let imageUrl: string | null = null;
  if (rawImage) {
    const candidate = parsePublicPreviewUrl(new URL(rawImage, current).toString());
    imageUrl = candidate?.toString() ?? null;
  }
  return {
    url: current.toString(),
    title: title.slice(0, 160),
    description: description.slice(0, 260),
    imageUrl,
    siteName: (metaContent(html, ["og:site_name"]) || current.hostname.replace(/^www\./, "")).slice(0, 80),
  };
}
