import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchGooglePlaceSuggestions,
  parsePlaceSuggestionRequest,
} from "../lib/google-place-suggestions.ts";
import {
  activeWishlistPlaceAtCursor,
  rebaseResolutionOverrides,
  requestPlaceSuggestions,
} from "../lib/place-suggestion-client.ts";
import { TRIP_REQUEST_HEADER } from "../lib/trip-request-identity.ts";

test("validates the bounded place suggestion request", () => {
  assert.deepEqual(parsePlaceSuggestionRequest({
    query: " リンツ ",
    languageCode: "ja",
    destination: "auto",
  }), {
    query: "リンツ",
    languageCode: "ja",
    destination: "auto",
  });
  assert.equal(parsePlaceSuggestionRequest({ query: "L", languageCode: "en", destination: "auto" }), null);
  assert.equal(parsePlaceSuggestionRequest({ query: "Linz", languageCode: "de", destination: "auto" }), null);
});

test("worldwide autocomplete removes request-IP bias and exposes Linz as a selectable Place ID", async () => {
  let providerBody: Record<string, unknown> = {};
  const suggestions = await fetchGooglePlaceSuggestions({
    query: "リンツ",
    languageCode: "ja",
    destination: "auto",
  }, "server-secret", async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), "server-secret");
    return Response.json({
      suggestions: [{
        placePrediction: {
          placeId: "ChIJ_Linz_Austria",
          text: { text: "リンツ, オーストリア" },
          structuredFormat: {
            mainText: { text: "リンツ" },
            secondaryText: { text: "オーストリア" },
          },
        },
      }],
    });
  });

  assert.deepEqual(suggestions, [{
    providerRef: "ChIJ_Linz_Austria",
    primaryText: "リンツ",
    secondaryText: "オーストリア",
    fullText: "リンツ, オーストリア",
  }]);
  assert.ok(providerBody.locationBias, "auto mode must replace implicit IP bias");
  assert.equal("regionCode" in providerBody, false);
  assert.equal(JSON.stringify(suggestions).includes("server-secret"), false);
});

test("an explicit country restricts autocomplete to that destination", async () => {
  let providerBody: Record<string, unknown> = {};
  await fetchGooglePlaceSuggestions({
    query: "Linz",
    languageCode: "en",
    destination: "austria",
  }, "server-secret", async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ suggestions: [] });
  });
  assert.deepEqual(providerBody.includedRegionCodes, ["at"]);
  assert.equal(providerBody.regionCode, "at");
  assert.equal("locationBias" in providerBody, false);
});

test("the active textarea line maps to the parsed input occurrence", () => {
  const raw = "1日目\nチューリッヒ\nインターラーケン 必須\nリンツ";
  const cursor = raw.indexOf("リンツ") + 2;
  assert.deepEqual(activeWishlistPlaceAtCursor(raw, cursor), { inputIndex: 2, query: "リンツ" });
  assert.equal(activeWishlistPlaceAtCursor(`${raw}\n`, raw.length + 1), null);
});

test("provider choices follow unchanged occurrences across textarea edits", () => {
  const previous = "チューリッヒ\nインターラーケン\nリンツ";
  const overrides = [
    { inputIndex: 0, providerRef: "ChIJ_zurich" },
    { inputIndex: 2, providerRef: "ChIJ_linz" },
  ];
  assert.deepEqual(
    rebaseResolutionOverrides(previous, `ベルン\n${previous}`, overrides),
    [
      { inputIndex: 1, providerRef: "ChIJ_zurich" },
      { inputIndex: 3, providerRef: "ChIJ_linz" },
    ],
  );
  assert.deepEqual(
    rebaseResolutionOverrides(previous, "チューリッヒ市\nインターラーケン\nリンツ", overrides),
    [{ inputIndex: 2, providerRef: "ChIJ_linz" }],
    "editing one name invalidates only that occurrence's provider choice",
  );

  assert.deepEqual(
    rebaseResolutionOverrides(
      "Linz\nLinz 必須",
      "Linz\nLinz\nLinz 必須",
      [{ inputIndex: 1, providerRef: "ChIJ_required_linz" }],
    ),
    [{ inputIndex: 2, providerRef: "ChIJ_required_linz" }],
    "constraint-bearing duplicate names retain the selected occurrence",
  );
  assert.deepEqual(
    rebaseResolutionOverrides(
      "Linz\nLinz",
      "Vienna\nLinz\nLinz",
      [{ inputIndex: 1, providerRef: "ChIJ_second_linz" }],
    ),
    [],
    "indistinguishable duplicate occurrences are conservatively reselected",
  );
});

test("the browser suggestion client sends only the typed query and opaque trip identity", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  let requestHeaders = new Headers();
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestHeaders = new Headers(init?.headers);
    return Response.json({
      suggestions: [{
        providerRef: "ChIJ_Linz_Austria",
        primaryText: "Linz",
        secondaryText: "Austria",
        fullText: "Linz, Austria",
      }],
    });
  }) as typeof fetch;
  try {
    const result = await requestPlaceSuggestions("Linz", "en", "auto");
    assert.equal(result[0]?.providerRef, "ChIJ_Linz_Austria");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requestBody, { query: "Linz", languageCode: "en", destination: "auto" });
  assert.match(requestHeaders.get(TRIP_REQUEST_HEADER) ?? "", /^trip_[A-Za-z0-9_-]+$/);
  assert.equal(requestHeaders.has("X-Goog-Api-Key"), false);
});
