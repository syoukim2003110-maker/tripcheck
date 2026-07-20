import assert from "node:assert/strict";
import test from "node:test";
import { fetchLinkPreview, parsePublicPreviewUrl } from "../lib/link-preview.ts";

test("accepts public HTTPS pages and blocks local or private preview targets", () => {
  assert.equal(parsePublicPreviewUrl("https://example.com/menu")?.hostname, "example.com");
  assert.equal(parsePublicPreviewUrl("http://example.com"), null);
  assert.equal(parsePublicPreviewUrl("https://localhost/menu"), null);
  assert.equal(parsePublicPreviewUrl("https://192.168.1.5/menu"), null);
  assert.equal(parsePublicPreviewUrl("https://[::1]/menu"), null);
});

test("extracts a title, description and absolute thumbnail from social metadata", async () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Nara Lunch" />
    <meta name="description" content="Seasonal Japanese food" />
    <meta property="og:image" content="/hero.jpg" />
    <meta property="og:site_name" content="Official restaurant site" />
  </head></html>`;
  const preview = await fetchLinkPreview(new URL("https://example.com/menu"), async () => new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));
  assert.equal(preview.title, "Nara Lunch");
  assert.equal(preview.description, "Seasonal Japanese food");
  assert.equal(preview.imageUrl, "https://example.com/hero.jpg");
  assert.equal(preview.siteName, "Official restaurant site");
});
