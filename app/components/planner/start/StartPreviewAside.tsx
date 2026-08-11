"use client";

// Start-surface preview aside (spec v2.1 start/StartPreviewAside): the static
// finished-trip illustration next to the places composer. Locale is its only
// input; every path, chip and metric is fixed sample copy.
import Icon from "../../../PlannerIcons";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type StartPreviewAsideProps = {
  locale: PlannerLocale;
};

export default function StartPreviewAside({ locale }: StartPreviewAsideProps) {
  return (
    <aside className="planner-start-preview" aria-label={locale === "ja" ? "できあがる旅程のイメージ" : "Preview of a finished trip"}>
      <header>
        <strong>{locale === "ja" ? "できあがる旅" : "The trip you get"}</strong>
        <span>{locale === "ja" ? "4日 · 8か所" : "4 days · 8 places"}</span>
      </header>
      <div className="planner-start-preview-canvas">
        <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 420 430">
          <path d="M-20 84 C90 30 150 128 230 88 S360 40 440 82" fill="none" stroke="#DDE2DC" strokeWidth="8" />
          <path d="M-10 330 C90 268 170 352 260 292 S370 236 440 268" fill="none" stroke="#E0E4DE" strokeWidth="11" />
          <path d="M64 372 C112 292 96 232 172 196 S286 168 336 104" fill="none" stroke="#2563EB" strokeLinecap="round" strokeWidth="7" />
          <circle cx="64" cy="372" fill="#2563EB" r="10" stroke="#fff" strokeWidth="4" />
          <circle cx="172" cy="196" fill="#2563EB" r="10" stroke="#fff" strokeWidth="4" />
          <circle cx="336" cy="104" fill="#2563EB" r="10" stroke="#fff" strokeWidth="4" />
        </svg>
        <span className="planner-start-chip is-hotel"><Icon name="bed" size={12} />{locale === "ja" ? "移動が少ないホテル" : "A base that cuts travel"}</span>
        <span className="planner-start-chip is-meal"><Icon name="fork" size={12} />{locale === "ja" ? "動線上のランチ" : "Lunch on the route"}</span>
        <span className="planner-start-chip is-gap"><Icon name="spark" size={12} />{locale === "ja" ? "45分で寄れるカフェ" : "A café for a 45-min gap"}</span>
      </div>
      <div className="planner-start-preview-card">
        <b><i aria-hidden="true"><Icon name="check" size={11} /></i>{locale === "ja" ? "4日なら、無理なく回れます" : "This works comfortably in 4 days"}</b>
        <small>{locale === "ja" ? "8か所 · 移動8時間40分 · 余裕4時間10分" : "8 places · 8h 40m travel · 4h 10m buffer"}</small>
        <div>
          <span aria-hidden="true">1</span>
          <p><b>{locale === "ja" ? "ラウターブルンネン → ユングフラウヨッホ" : "Lauterbrunnen → Jungfraujoch"}</b><small>{locale === "ja" ? "4か所 · 余裕1時間30分" : "4 stops · 1h 30m buffer"}</small></p>
        </div>
      </div>
    </aside>
  );
}
