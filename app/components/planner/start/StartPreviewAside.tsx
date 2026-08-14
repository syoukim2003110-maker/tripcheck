"use client";

// Start-surface preview aside (spec v2.1 start/StartPreviewAside): what a
// finished trip looks like, beside the places composer. Locale is its only
// input; every day, base, meal and metric below is fixed sample copy.
//
// UI/UX v3.1 §6.1 / reference 01: the handoff shows a real day-by-day preview
// here, not an abstract shape — day numbers in the day palette, where each
// night is spent, where lunch falls. The abstract version this replaces said
// "TripCheck plans things" without showing what a plan looks like, which is
// the one job this panel has on a screen the traveller has not used yet.
//
// It stays a labelled sample. The panel's own heading names it as one, and
// nothing here is presented as a live result.
import Icon from "../../../PlannerIcons";
import { PLANNER_MAP_DAY_COLORS } from "../../../../lib/planner-map-model.ts";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type StartPreviewAsideProps = {
  locale: PlannerLocale;
};

type PreviewDay = { title: string; base: string; meal: string };

const previewDays: Record<PlannerLocale, PreviewDay[]> = {
  ja: [
    { title: "ルツェルン到着・市内散策", base: "ルツェルン泊", meal: "湖畔でランチ" },
    { title: "リギ山ハイキングと絶景", base: "ルツェルン泊", meal: "山頂でランチ" },
    { title: "ユングフラウヨッホへ", base: "グリンデルワルト泊", meal: "展望レストラン" },
    { title: "ラウターブルンネン散策", base: "グリンデルワルト泊", meal: "カフェでランチ" },
  ],
  en: [
    { title: "Arrive in Lucerne, walk the old town", base: "Night in Lucerne", meal: "Lunch by the lake" },
    { title: "Rigi hike and the long view", base: "Night in Lucerne", meal: "Lunch at the summit" },
    { title: "Up to the Jungfraujoch", base: "Night in Grindelwald", meal: "Panorama restaurant" },
    { title: "Lauterbrunnen valley walk", base: "Night in Grindelwald", meal: "Lunch at a café" },
  ],
};

export default function StartPreviewAside({ locale }: StartPreviewAsideProps) {
  const days = previewDays[locale];
  return (
    <aside className="planner-start-preview" aria-label={locale === "ja" ? "できあがる旅程の例" : "Example of a finished trip"}>
      <header>
        <strong>{locale === "ja" ? "旅程プレビュー" : "Itinerary preview"}</strong>
        <span>{locale === "ja" ? "例：スイス4日・8か所" : "Sample · Switzerland, 4 days, 8 places"}</span>
      </header>
      <div className="planner-start-preview-body">
        <ol className="planner-start-preview-days">
          {days.map((day, index) => (
            <li key={day.title}>
              <span
                className="planner-start-preview-daynum"
                style={{ background: PLANNER_MAP_DAY_COLORS[index % PLANNER_MAP_DAY_COLORS.length] }}
              >{index + 1}</span>
              <div>
                <b>{day.title}</b>
                <small><Icon name="bed" size={11} />{day.base}</small>
                <small><Icon name="fork" size={11} />{day.meal}</small>
              </div>
            </li>
          ))}
        </ol>
        <div className="planner-start-preview-canvas">
          <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 420 430">
            <path d="M-20 84 C90 30 150 128 230 88 S360 40 440 82" fill="none" stroke="#DDE2DC" strokeWidth="8" />
            <path d="M-10 330 C90 268 170 352 260 292 S370 236 440 268" fill="none" stroke="#E0E4DE" strokeWidth="11" />
            <path d="M64 372 C112 292 96 232 172 196 S286 168 336 104" fill="none" stroke={PLANNER_MAP_DAY_COLORS[0]} strokeLinecap="round" strokeWidth="7" />
            <circle cx="64" cy="372" fill={PLANNER_MAP_DAY_COLORS[3]} r="10" stroke="#fff" strokeWidth="4" />
            <circle cx="172" cy="196" fill={PLANNER_MAP_DAY_COLORS[1]} r="10" stroke="#fff" strokeWidth="4" />
            <circle cx="336" cy="104" fill={PLANNER_MAP_DAY_COLORS[0]} r="10" stroke="#fff" strokeWidth="4" />
          </svg>
          <span className="planner-start-chip is-hotel"><Icon name="bed" size={12} />{locale === "ja" ? "移動が少ないホテル" : "A base that cuts travel"}</span>
          <span className="planner-start-chip is-meal"><Icon name="fork" size={12} />{locale === "ja" ? "動線上のランチ" : "Lunch on the route"}</span>
          <span className="planner-start-chip is-gap"><Icon name="spark" size={12} />{locale === "ja" ? "45分で寄れるカフェ" : "A café for a 45-min gap"}</span>
        </div>
      </div>
      <div className="planner-start-preview-card">
        <b><i aria-hidden="true"><Icon name="check" size={11} /></i>{locale === "ja" ? "4日なら、無理なく回れます" : "This works comfortably in 4 days"}</b>
        <small>{locale === "ja" ? "8か所 · 移動8時間40分 · 余裕4時間10分" : "8 places · 8h 40m travel · 4h 10m buffer"}</small>
      </div>
    </aside>
  );
}
