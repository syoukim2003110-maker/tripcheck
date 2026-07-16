import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripCheckApp from "../TripCheckApp";

export const metadata: Metadata = {
  title: "東京旅行の旅程チェッカー | TripCheck Japan",
  description: "東京旅行の予定が現実に成立するかを検査。無理な移動、崩れやすい予約、詰め込みすぎを見つけ、理由付きの改善案を示します。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <><StructuredData locale="ja" /><TripCheckApp initialLocale="ja" /></>;
}
