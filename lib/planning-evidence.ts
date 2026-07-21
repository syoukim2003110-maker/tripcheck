import type { FreshVoicesResult } from "./fresh-voices.ts";
import type { PlaceIntelligenceResult } from "./place-intelligence.ts";

export type SoftDurationReason = "crowd" | "queue" | "sold_out" | "early_close" | "detour";

export type StopPlanningEvidence = {
  bufferMinutes: 0 | 15 | 30;
  evidenceCount: number;
  reasons: SoftDurationReason[];
  sourceCounts: {
    googleReviews: number;
    publicWeb: number;
  };
};

type ClassifiedEvidence = {
  reasons: SoftDurationReason[];
  source: keyof StopPlanningEvidence["sourceCounts"];
  text: string;
};

const explicitPatterns: Record<SoftDurationReason, RegExp> = {
  crowd: /(?:かなり|とても|非常に|すごく)?\s*混(?:雑|んで|み合)|人(?:が|で)?\s*(?:多すぎ|いっぱい)|大混雑|packed|overcrowded|very\s+busy|extremely\s+busy/i,
  queue: /行列|長蛇|待ち時間|\d+\s*分待ち|並んで|queue|queued|long\s+line|wait(?:ed|ing)?\s+(?:for\s+)?\d+/i,
  sold_out: /売り切れ|売切れ|完売|品切れ|整理券(?:が)?終了|sold\s*out|ran\s*out|no\s+tickets?\s+left/i,
  early_close: /早じまい|早仕舞い|予定より早く(?:閉|終了)|営業時間より早く(?:閉|終了)|受付(?:が)?早めに終了|最終受付|closes?\s+early|closed\s+earlier|earlier\s+than\s+(?:posted|listed)|early\s+cutoff|last\s+(?:entry|admission)/i,
  detour: /迂回|遠回り|回り道|入口(?:が|は)?(?:分かり|わかり)にく|detour|long\s+way\s+around|hard\s+to\s+find\s+(?:the\s+)?entrance/i,
};

const negatedPatterns: Partial<Record<SoftDurationReason, RegExp>> = {
  crowd: /(?:混雑|混んで|混み合)(?:は|が|も|して|し|い)?な(?:い|かった|く)|空いていた|not\s+(?:busy|crowded)|wasn['’]?t\s+(?:busy|crowded)/i,
  queue: /行列(?:は|が|も)?な(?:い|かった|く)|待ち時間(?:は|が|も)?な(?:い|かった|く)|並ばず|no\s+(?:queue|line|wait)|without\s+(?:a\s+)?wait/i,
  sold_out: /売り切れ(?:では|じゃ)?な(?:い|かった|く)|完売(?:では|じゃ)?な(?:い|かった|く)|not\s+sold\s*out/i,
  early_close: /早(?:じまい|仕舞い)(?:は|し)?な(?:い|かった|く)|didn['’]?t\s+close\s+early/i,
  detour: /迂回(?:は|が)?不要|遠回り(?:は|が)?不要|no\s+detour/i,
};

const reasonOrder: SoftDurationReason[] = ["crowd", "queue", "sold_out", "early_close", "detour"];

function normalizeEvidenceText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function classify(text: string): SoftDurationReason[] {
  return reasonOrder.filter((reason) => (
    explicitPatterns[reason].test(text) && !negatedPatterns[reason]?.test(text)
  ));
}

/**
 * Turns only explicit, user-visible evidence into a small schedule buffer.
 * Business status and generic words such as "closed" are deliberately ignored:
 * hard availability decisions belong to verified opening-hours logic, not this helper.
 */
export function deriveStopPlanningEvidence(
  placeIntelligence: PlaceIntelligenceResult | null | undefined,
  freshVoices: FreshVoicesResult | null | undefined,
): StopPlanningEvidence {
  const candidates: ClassifiedEvidence[] = [];

  for (const review of placeIntelligence?.reviews ?? []) {
    const text = normalizeEvidenceText(review.text);
    const reasons = classify(text);
    if (reasons.length > 0) candidates.push({ reasons, source: "googleReviews", text });
  }

  for (const finding of freshVoices?.findings ?? []) {
    const text = normalizeEvidenceText(`${finding.title} ${finding.note}`);
    const reasons = classify(text);
    if (reasons.length > 0) candidates.push({ reasons, source: "publicWeb", text });
  }

  const unique = new Map<string, ClassifiedEvidence>();
  for (const evidence of candidates) {
    const key = evidence.text.toLocaleLowerCase("ja-JP");
    if (!unique.has(key)) unique.set(key, evidence);
  }
  const evidence = [...unique.values()];
  const evidenceCount = evidence.length;
  const reasons = reasonOrder.filter((reason) => evidence.some((item) => item.reasons.includes(reason)));
  const sourceCounts = evidence.reduce<StopPlanningEvidence["sourceCounts"]>(
    (counts, item) => ({ ...counts, [item.source]: counts[item.source] + 1 }),
    { googleReviews: 0, publicWeb: 0 },
  );

  return {
    bufferMinutes: evidenceCount === 0 ? 0 : evidenceCount === 1 ? 15 : 30,
    evidenceCount,
    reasons,
    sourceCounts,
  };
}
