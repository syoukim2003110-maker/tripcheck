import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const routeHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const match = specifier.match(/^(?:\.\.\/){3,4}lib\/(.+)$/);
    if (match && context.parentURL?.includes("/app/api/")) {
      return nextResolve(new URL(`../lib/${match[1]}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
type PostHandler = (request: Request) => Promise<Response>;
const { POST } = await import(new URL("../app/api/place-resolution/open/route.ts", import.meta.url).href) as { POST: PostHandler };
routeHooks.deregister();

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://tripcheck.test/api/place-resolution/open", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function validBody(query = "Lauterbrunnen") {
  return {
    queries: [query],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "en",
    destination: "switzerland",
  };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("the keyless route guards origin, caps work and returns attributed open-data facts", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOrigin = process.env.TRIPCHECK_PUBLIC_ORIGIN;
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  mutableEnvironment.NODE_ENV = "production";
  process.env.TRIPCHECK_PUBLIC_ORIGIN = "https://tripcheck.test";
  let providerCalls = 0;
  const hosts = new Set<string>();
  globalThis.fetch = (async (input, init) => {
    providerCalls += 1;
    const url = new URL(String(input));
    hosts.add(url.host);
    assert.match(new Headers(init?.headers).get("User-Agent") ?? "", /^TripCheck\//);
    if (url.host === "en.wikipedia.org" && url.searchParams.get("list") === "search") {
      assert.equal(url.searchParams.get("srsearch"), "Lauterbrunnen");
      return Response.json({ query: { search: [{ pageid: 70123, title: "Lauterbrunnen" }] } });
    }
    if (url.host === "en.wikipedia.org") {
      return Response.json({ query: { pages: [{
        pageid: 70123,
        title: "Lauterbrunnen",
        length: 24_000,
        description: "Municipality in Bern, Switzerland",
        coordinates: [{ lat: 46.5938, lon: 7.9091, primary: true, globe: "earth", country: "CH" }],
        pageprops: { wikibase_item: "Q64011" },
      }] } });
    }
    if (url.host === "query.wikidata.org") {
      return Response.json({ results: { bindings: [{
        item: { value: "http://www.wikidata.org/entity/Q64011" },
        adminLabel: { value: "Interlaken-Oberhasli" },
        iso: { value: "CH" },
      }] } });
    }
    if (url.host === "www.wikidata.org") return Response.json({ query: { pages: [] } });
    // The public Photon instance refusing a request must not fail the lookup.
    if (url.host === "photon.komoot.io") return new Response("busy", { status: 503 });
    throw new Error(`unexpected provider host ${url.host}`);
  }) as typeof fetch;

  try {
    const forbidden = await POST(request(validBody(), {
      Origin: "https://evil.test",
      "Sec-Fetch-Site": "cross-site",
    }));
    assert.equal(forbidden.status, 403);
    assert.equal(providerCalls, 0);

    const overCap = await POST(request({
      ...validBody(),
      queries: Array.from({ length: 30 }, (_, index) => `Place ${index}`),
      hotelQuery: "Hotel",
    }, {
      Origin: "https://tripcheck.test",
      "Sec-Fetch-Site": "same-origin",
    }));
    assert.equal(overCap.status, 429);
    assert.equal((await overCap.json() as { code: string }).code, "request_cap_exceeded");
    assert.equal(providerCalls, 0);

    const response = await POST(request(validBody(), {
      Origin: "https://tripcheck.test",
      "Sec-Fetch-Site": "same-origin",
    }));
    const body = await response.json() as {
      provider: string;
      attribution: { label: string; url: string };
      places: Array<Record<string, unknown>>;
    };
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(body.provider, "open_place_data");
    assert.deepEqual(body.attribution, {
      label: "© OpenStreetMap contributors · Wikipedia",
      url: "https://www.openstreetmap.org/copyright",
    });
    assert.equal(body.places[0]?.name, "Lauterbrunnen");
    assert.equal(body.places[0]?.sourceUrl, "https://en.wikipedia.org/?curid=70123");
    assert.equal(body.places[0]?.area, "Interlaken-Oberhasli");
    assert.equal(body.places[0]?.countryCode, "CH");
    assert.equal(body.places[0]?.confidence, "medium");
    assert.equal(typeof body.places[0]?.verifiedAt, "string");
    assert.ok(providerCalls >= 4);
    // A confident encyclopedia answer never reaches rate-limited Nominatim.
    assert.equal(hosts.has("nominatim.openstreetmap.org"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restore("NODE_ENV", originalNodeEnv);
    restore("TRIPCHECK_PUBLIC_ORIGIN", originalOrigin);
  }
});
