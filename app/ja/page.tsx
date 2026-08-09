import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripPlannerApp from "../TripPlannerApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TripCheck — 旅程の実行可能性チェッカー",
  description: "行きたい場所を貼るだけ。経路、営業時間、予約、空港と使える時間を照合し、実際に回れる順番と必要日数を示します。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <div lang="ja"><StructuredData locale="ja" /><TripPlannerApp initialLocale="ja" mapsApiKey={process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? ""} /></div>;
}
