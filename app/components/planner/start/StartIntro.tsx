"use client";

// Start-surface heading block (spec v2.1 start/StartIntro): the eyebrow,
// headline and lede that switch between the places ask and the reviewed-place
// summary. Pure copy over counts the parent computes from the review rows.
import type { PlannerInputStep } from "../../../../lib/planner-app-state.ts";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type StartIntroProps = {
  inputStep: PlannerInputStep;
  locale: PlannerLocale;
  unresolvedReviewedCount: number;
  ambiguousReviewedCount: number;
  confirmedReviewedCount: number;
  reviewedPlaceCount: number;
};

export default function StartIntro({
  inputStep,
  locale,
  unresolvedReviewedCount,
  ambiguousReviewedCount,
  confirmedReviewedCount,
  reviewedPlaceCount,
}: StartIntroProps) {
  return (
    <div className="planner-intro">
      {inputStep === "places" ? (
        <span className="planner-intro-eyebrow">{locale === "ja" ? "旅行の下ごしらえ、ここまで。" : "Turn saved places into a trip."}</span>
      ) : null}
      <h1 id={inputStep === "conditions" ? "planner-reviewed-title" : undefined}>{inputStep === "places"
        ? locale === "ja" ? "行きたい場所だけ、決めてください。" : "Just choose the places."
        : unresolvedReviewedCount + ambiguousReviewedCount > 0
          ? locale === "ja" ? "場所を確認してください" : "Check the places"
          : locale === "ja" ? `${confirmedReviewedCount}か所を確認しました` : `${confirmedReviewedCount} place${confirmedReviewedCount === 1 ? "" : "s"} found`}</h1>
      <p>{inputStep === "places"
        ? locale === "ja" ? "日ごとの組み合わせ、回る順番、ホテル、食事、寄り道までまとめます。" : "We’ll group the days, order the stops, choose a practical base, and fill meals and gaps."
        : unresolvedReviewedCount + ambiguousReviewedCount > 0
          ? locale === "ja"
            ? `${reviewedPlaceCount}か所を見つけました。確認が必要なのは${unresolvedReviewedCount + ambiguousReviewedCount}件だけです。未解決の場所は推測せず残します。`
            : `Found ${reviewedPlaceCount} place${reviewedPlaceCount === 1 ? "" : "s"}. Only ${unresolvedReviewedCount + ambiguousReviewedCount} need${unresolvedReviewedCount + ambiguousReviewedCount === 1 ? "s" : ""} a quick look — unresolved places stay explicit, never guessed.`
          : locale === "ja" ? "すべて確認できました。そのまま旅程づくりへ進めます。" : "Everything is settled — continue to the itinerary."}</p>
    </div>
  );
}
