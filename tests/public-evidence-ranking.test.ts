import assert from "node:assert/strict";
import test from "node:test";
import { foodPublicEvidenceScore, rankFoodWithPublicEvidence } from "../lib/public-evidence-ranking.ts";
import type { FreshVoicesResult } from "../lib/fresh-voices.ts";
import type { FoodCandidate } from "../lib/google-food.ts";

function candidate(id: string): FoodCandidate {
  return {
    id,
    name: id,
    address: "Tokyo",
    type: "Restaurant",
    googleMapsUrl: `https://maps.google.com/${id}`,
    distanceMeters: 100,
    rating: 4.5,
    userRatingCount: 100,
    openNow: true,
    hours: [],
    businessStatus: "OPERATIONAL",
    paymentEvidence: [],
    reviewSnippets: [],
    websiteUrl: null,
  };
}

function fresh(sourceKind: "social" | "web", note: string): FreshVoicesResult {
  return {
    provider: "anthropic_web_search",
    checkedAt: "2026-07-21T00:00:00Z",
    summary: note,
    findings: [{ title: "Public source", url: "https://x.com/example/status/1", note, age: "today", isRecent: true, sourceKind }],
    searchCount: 1,
    intent: "food",
    depth: "quick",
  };
}

test("preserves Google order when no cited public evidence exists", () => {
  assert.deepEqual(rankFoodWithPublicEvidence([candidate("a"), candidate("b")], {}).map((item) => item.id), ["a", "b"]);
});

test("allows cited social evidence to promote a shortlisted restaurant", () => {
  const ranked = rankFoodWithPublicEvidence([candidate("a"), candidate("b")], { b: fresh("social", "A popular local favorite and a must-try.") });
  assert.deepEqual(ranked.map((item) => item.id), ["b", "a"]);
});

test("counts engagement only when the cited text contains an explicit number", () => {
  assert.equal(foodPublicEvidenceScore(fresh("social", "Popular post")), 3);
  assert.equal(foodPublicEvidenceScore(fresh("social", "12,400 likes on the cited post")), 5);
});

test("generic mentions do not promote, while explicit operational risks penalize", () => {
  assert.equal(foodPublicEvidenceScore(fresh("social", "Recently discussed by local visitors.")), 0);
  assert.ok(foodPublicEvidenceScore(fresh("social", "Temporarily closed today.")) < 0);
  assert.ok(foodPublicEvidenceScore(fresh("web", "Sold out early and had a long queue.")) < 0);
  assert.equal(foodPublicEvidenceScore(fresh("social", "No queue today and open as usual.")), 0);
});

test("risk evidence cannot accidentally promote the lower Google candidate", () => {
  const ranked = rankFoodWithPublicEvidence([candidate("a"), candidate("b")], {
    b: fresh("social", "Long queue and sold out before dinner."),
  });
  assert.deepEqual(ranked.map((item) => item.id), ["a", "b"]);
});

test("source-only search results never change the Google shortlist order", () => {
  const sourceOnly = fresh("social", "12,400 likes and a viral must-try");
  sourceOnly.findings[0].evidenceLevel = "source_only";
  assert.equal(foodPublicEvidenceScore(sourceOnly), 0);
  assert.deepEqual(rankFoodWithPublicEvidence([candidate("a"), candidate("b")], { b: sourceOnly }).map((item) => item.id), ["a", "b"]);
});
