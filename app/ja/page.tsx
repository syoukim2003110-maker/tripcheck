import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripPlannerApp from "../TripPlannerApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TripCheck — 行きたい場所から、そのまま使える旅程へ",
  description: "行きたい場所を入れるだけ。日別の組み合わせ、順番、移動、実用的なホテル拠点、無理のない食事候補まで組み、実際に回れるか確認します。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <div lang="ja"><StructuredData locale="ja" /><TripPlannerApp initialLocale="ja" mapsApiKey={process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? ""} /></div>;
}
