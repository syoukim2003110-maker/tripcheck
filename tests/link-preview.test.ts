import assert from "node:assert/strict";
import test from "node:test";
import { fetchLinkPreview, parsePublicPreviewUrl } from "../lib/link-preview.ts";
import {
  assertPublicNetworkTarget,
  isPublicIpAddress,
  resolvePublicHostAddresses,
} from "../lib/server/public-url-policy.ts";

const publicResolver = async () => ["93.184.216.34"];

test("accepts public HTTPS pages and blocks non-HTTPS, credentialed and non-standard-port targets", () => {
  assert.equal(parsePublicPreviewUrl("https://example.com/menu")?.hostname, "example.com");
  for (const blocked of [
    "http://example.com",
    "ftp://example.com/menu",
    "file:///etc/passwd",
    "data:text/html,hello",
    "javascript:alert(1)",
    "https://user:password@example.com/menu",
    "https://example.com:8443/menu",
  ]) {
    assert.equal(parsePublicPreviewUrl(blocked), null, blocked);
  }
});

test("blocks loopback, private, link-local, metadata and reserved literal addresses", () => {
  const blocked = [
    "https://localhost/menu",
    "https://localhost./menu",
    "https://preview.local/menu",
    "https://service.internal/menu",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://127.0.0.1/menu",
    "https://2130706433/menu",
    "https://0x7f000001/menu",
    "https://10.0.0.8/menu",
    "https://100.100.100.200/latest/meta-data/",
    "https://169.254.169.254/latest/meta-data/",
    "https://172.16.0.1/menu",
    "https://192.168.1.5/menu",
    "https://192.0.0.192/menu",
    "https://198.51.100.10/menu",
    "https://224.0.0.1/menu",
    "https://[::1]/menu",
    "https://[fe80::1]/menu",
    "https://[fd00:ec2::254]/menu",
    "https://[::ffff:127.0.0.1]/menu",
    "https://[2001:db8::1]/menu",
  ];
  for (const url of blocked) assert.equal(parsePublicPreviewUrl(url), null, url);

  assert.equal(parsePublicPreviewUrl("https://8.8.8.8/menu")?.hostname, "8.8.8.8");
  assert.ok(parsePublicPreviewUrl("https://[2606:4700:4700::1111]/menu"));
});

test("IP policy rejects every non-public family while allowing global unicast", () => {
  for (const address of [
    "0.0.0.0", "127.0.0.1", "169.254.1.1", "192.168.1.1", "100.64.0.1",
    "::", "::1", "fe80::1", "fc00::1", "ff02::1", "2001:db8::1", "::ffff:10.0.0.1",
  ]) assert.equal(isPublicIpAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicIpAddress(address), true, address);
  }
});

test("DNS validation fails closed for empty, private, link-local or mixed answers", async () => {
  const target = new URL("https://example.com/menu");
  for (const addresses of [
    [],
    ["127.0.0.1"],
    ["169.254.169.254"],
    ["93.184.216.34", "10.0.0.2"],
    ["2606:4700:4700::1111", "fd00::1"],
  ]) {
    await assert.rejects(() => assertPublicNetworkTarget(target, async () => addresses));
  }
  assert.equal((await assertPublicNetworkTarget(target, publicResolver)).hostname, "example.com");
});

test("default DoH resolver collects only A and AAAA records and fails closed on DNS errors", async () => {
  const queries: string[] = [];
  const addresses = await resolvePublicHostAddresses("example.com", async (input) => {
    const url = new URL(String(input));
    queries.push(url.searchParams.get("type") ?? "");
    return Response.json({
      Status: 0,
      Answer: url.searchParams.get("type") === "A"
        ? [{ type: 5, data: "alias.example.com." }, { type: 1, data: "93.184.216.34" }]
        : [{ type: 28, data: "2606:4700:4700::1111" }],
    });
  });
  assert.deepEqual(queries.sort(), ["A", "AAAA"]);
  assert.deepEqual(addresses.sort(), ["2606:4700:4700::1111", "93.184.216.34"]);

  await assert.rejects(() => resolvePublicHostAddresses("example.com", async () => new Response("down", { status: 503 })));
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
  }), publicResolver);
  assert.equal(preview.title, "Nara Lunch");
  assert.equal(preview.description, "Seasonal Japanese food");
  assert.equal(preview.imageUrl, "https://example.com/hero.jpg");
  assert.equal(preview.siteName, "Official restaurant site");
});

test("revalidates every redirect and never fetches a redirect target resolving to private metadata", async () => {
  const fetched: string[] = [];
  const resolved: string[] = [];
  await assert.rejects(() => fetchLinkPreview(
    new URL("https://public.example/start"),
    async (input) => {
      fetched.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { Location: "https://redirect.example/latest/meta-data/" },
      });
    },
    async (hostname) => {
      resolved.push(hostname);
      return hostname === "redirect.example" ? ["169.254.169.254"] : ["93.184.216.34"];
    },
  ));
  assert.deepEqual(fetched, ["https://public.example/start"]);
  assert.deepEqual(resolved, ["public.example", "redirect.example"]);
});

test("rejects syntactically unsafe redirects before a second fetch", async () => {
  for (const location of [
    "http://example.com/insecure",
    "https://user:password@example.com/private",
    "https://127.0.0.1/internal",
    "file:///etc/passwd",
  ]) {
    let fetchCalls = 0;
    await assert.rejects(() => fetchLinkPreview(
      new URL("https://public.example/start"),
      async () => {
        fetchCalls += 1;
        return new Response(null, { status: 302, headers: { Location: location } });
      },
      publicResolver,
    ));
    assert.equal(fetchCalls, 1, location);
  }
});

test("allows a fully public redirect chain after resolving each hop", async () => {
  const fetched: string[] = [];
  const preview = await fetchLinkPreview(
    new URL("https://one.example/start"),
    async (input, init) => {
      fetched.push(String(input));
      assert.equal(init?.redirect, "manual");
      if (fetched.length === 1) {
        return new Response(null, { status: 302, headers: { Location: "https://two.example/final" } });
      }
      return new Response("<title>Safe final page</title>", { headers: { "Content-Type": "text/html" } });
    },
    publicResolver,
  );
  assert.deepEqual(fetched, ["https://one.example/start", "https://two.example/final"]);
  assert.equal(preview.url, "https://two.example/final");
  assert.equal(preview.title, "Safe final page");
});
