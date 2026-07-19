import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripCheckApp from "../TripCheckApp";

export const metadata: Metadata = {
  title: "東京旅行の自動プラン作成・ルート最適化 | TripCheck Japan",
  description: "東京で行きたい場所、ホテル、飛行機を入力。日別ルート、宿泊エリア比較、移動手段、空港へ向かう締切までまとめて作ります。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <><StructuredData locale="ja" /><TripCheckApp initialLocale="ja" /></>;
}
