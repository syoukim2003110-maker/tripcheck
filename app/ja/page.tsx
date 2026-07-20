import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripCheckApp from "../TripCheckApp";

export const metadata: Metadata = {
  title: "日本旅行の自動プラン作成・Googleマップ旅程 | TripCheck Japan",
  description: "日本全国の行きたい場所を入力。日別ルート、ホテル、食事エリア、空港までを一つのGoogleマップにまとめます。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <><StructuredData locale="ja" /><TripCheckApp initialLocale="ja" /></>;
}
