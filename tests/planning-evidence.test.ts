import assert from "node:assert/strict";
import test from "node:test";
import { deriveStopPlanningEvidence } from "../lib/planning-evidence.ts";
import type { FreshVoicesResult } from "../lib/fresh-voices.ts";
import type { PlaceIntelligenceResult } from "../lib/place-intelligence.ts";

function placeWithReviews(texts: string[]): PlaceIntelligenceResult {
  return {
    provider: "google_places",
    checkedAt: "2026-07-21T00:00:00.000Z",
    analyzedBy: "rules",
    place: {
      name: "Sample",
      address: "Tokyo",
      googleMapsUrl: "https://maps.google.com/sample",
      websiteUrl: null,
      businessStatus: "OPERATIONAL",
      rating: 4.2,
      userRatingCount: 100,
      openNow: null,
      hours: [],
      payment: { cashOnly: null, creditCards: null, debitCards: null, nfc: null, observations: [] },
    },
    reviews: texts.map((text, index) => ({
      rating: 4,
      text,
      publishedAt: "2026-07-20T00:00:00Z",
      relativeTime: "1 day ago",
      authorName: `Guest ${index + 1}`,
      authorUri: null,
      googleMapsUri: null,
    })),
    analysis: { summary: "Checked.", confidence: "medium", signals: [], nextCheck: "Recheck." },
    links: { x: "https://x.com/search", instagram: "https://instagram.com/search" },
  };
}

function freshWithNotes(notes: string[]): FreshVoicesResult {
  return {
    provider: "anthropic_web_search",
    checkedAt: "2026-07-21T00:00:00.000Z",
    summary: "",
    findings: notes.map((note, index) => ({
      title: `Source ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      note,
      age: "1 day ago",
      isRecent: true,
      sourceKind: "web",
    })),
    searchCount: 1,
    intent: "place",
    depth: "quick",
  };
}

test("returns no buffer for generic closure or unsupported inference", () => {
  const result = deriveStopPlanningEvidence(
    placeWithReviews(["The shop was closed when I arrived.", "Access was convenient.", "混雑はなく、行列もなかった。"]),
    freshWithNotes(["The official page lists a temporary closure."]),
  );

  assert.deepEqual(result, {
    bufferMinutes: 0,
    evidenceCount: 0,
    reasons: [],
    sourceCounts: { googleReviews: 0, publicWeb: 0 },
  });
});

test("adds fifteen minutes for one explicit queue report", () => {
  const result = deriveStopPlanningEvidence(placeWithReviews(["昼は長い行列で40分待ちでした。"]), null);

  assert.equal(result.bufferMinutes, 15);
  assert.equal(result.evidenceCount, 1);
  assert.deepEqual(result.reasons, ["queue"]);
  assert.deepEqual(result.sourceCounts, { googleReviews: 1, publicWeb: 0 });
});

test("caps the soft buffer at thirty minutes and keeps deterministic reason order", () => {
  const result = deriveStopPlanningEvidence(
    placeWithReviews(["It was packed and there was a long line."]),
    freshWithNotes(["入口が分かりにくく、迂回が必要だった。", "夕方には売り切れでした。"]),
  );

  assert.equal(result.bufferMinutes, 30);
  assert.equal(result.evidenceCount, 3);
  assert.deepEqual(result.reasons, ["crowd", "queue", "sold_out", "detour"]);
  assert.deepEqual(result.sourceCounts, { googleReviews: 1, publicWeb: 2 });
});

test("deduplicates identical evidence before computing the buffer", () => {
  const fresh = freshWithNotes(["週末は大混雑でした。", "週末は大混雑でした。"]).findings;
  fresh[1] = { ...fresh[0], url: "https://example.com/duplicate" };
  const result = deriveStopPlanningEvidence(null, { ...freshWithNotes([]), findings: fresh });

  assert.equal(result.bufferMinutes, 15);
  assert.equal(result.evidenceCount, 1);
  assert.deepEqual(result.reasons, ["crowd"]);
});

test("does not turn a source-only search result into a schedule claim", () => {
  const sourceOnly = freshWithNotes(["長い行列で売り切れたとの情報"]);
  sourceOnly.findings[0].evidenceLevel = "source_only";
  const result = deriveStopPlanningEvidence(null, sourceOnly);

  assert.equal(result.bufferMinutes, 0);
  assert.equal(result.evidenceCount, 0);
});
