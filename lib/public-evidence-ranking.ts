import type { FreshVoicesResult } from "./fresh-voices.ts";
import type { FoodCandidate } from "./google-food.ts";

function explicitEngagementScore(text: string) {
  const normalized = text.normalize("NFKC");
  return /\b\d[\d,.万kK]*\s*(?:likes?|views?|reposts?|shares?)\b|\d[\d,.万]*\s*(?:いいね|件のいいね|回再生|リポスト)/i.test(normalized) ? 2 : 0;
}

function positivePopularityScore(text: string, sourceKind: "social" | "web") {
  const normalized = text.normalize("NFKC");
  const engagement = explicitEngagementScore(normalized);
  const clearlyPopular = /(?:人気|話題|注目|評判|バズ(?:った|って|り)?|行くべき|必食|地元で愛され|予約が取れない|must[- ]try|popular|viral|trending|buzz(?:ed|ing)?|local favou?rite|widely recommended)/i.test(normalized);
  if (!clearlyPopular && engagement === 0) return 0;
  return (sourceKind === "social" ? 3 : 1) + engagement;
}

function operationalRiskScore(text: string) {
  const normalized = text.normalize("NFKC");
  let penalty = 0;
  const noClosure = /(?:休業|閉店|営業終了)(?:ではない|していない)|not (?:closed|closing)|open as usual|通常営業/i.test(normalized);
  const noSellout = /売り切れ(?:ではない|ていない)|not sold out|still available/i.test(normalized);
  const noQueue = /行列(?:なし|はない)|待ち時間(?:なし|はない)|no (?:queue|line|wait)|without (?:a )?(?:queue|line|wait)/i.test(normalized);
  if (!noClosure && /臨時休業|休業中|閉店|営業終了|temporarily closed|permanently closed|closed (?:today|now|until|for)|closing early|early clos(?:e|ing)/i.test(normalized)) penalty += 4;
  if (!noSellout && /売り切れ|品切れ|完売|sold out|ran out|sells? out/i.test(normalized)) penalty += 3;
  if (!noQueue && /行列|長蛇|待ち時間|入店待ち|\bqueue\b|long line|\bwait(?:ing)?\s+(?:time|for)\b/i.test(normalized)) penalty += 2;
  if (/予約必須|要予約|reservation required|booking required/i.test(normalized)) penalty += 2;
  return penalty;
}

export function foodPublicEvidenceScore(result: FreshVoicesResult | null | undefined) {
  if (!result) return 0;
  return result.findings.reduce((score, finding) => {
    const text = `${finding.title} ${finding.note}`;
    return score + positivePopularityScore(text, finding.sourceKind === "social" ? "social" : "web") - operationalRiskScore(text);
  }, 0);
}

/**
 * Google evidence establishes the shortlist. Cited public evidence may swap the
 * top two, but cannot introduce an unverified restaurant or erase the stable
 * Google order when no useful public source was found.
 */
export function rankFoodWithPublicEvidence(
  candidates: FoodCandidate[],
  evidenceByCandidateId: Record<string, FreshVoicesResult | null | undefined>,
) {
  const basePosition = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  return [...candidates].sort((left, right) => {
    const leftIndex = basePosition.get(left.id) ?? candidates.length;
    const rightIndex = basePosition.get(right.id) ?? candidates.length;
    const leftScore = (candidates.length - leftIndex) * 2 + foodPublicEvidenceScore(evidenceByCandidateId[left.id]);
    const rightScore = (candidates.length - rightIndex) * 2 + foodPublicEvidenceScore(evidenceByCandidateId[right.id]);
    return rightScore - leftScore || leftIndex - rightIndex || left.id.localeCompare(right.id);
  });
}
