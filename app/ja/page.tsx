import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripPlannerApp from "../TripPlannerApp";

export const metadata: Metadata = {
  title: "TripCheck — 日本旅行プランナー",
  description: "日本全国の行きたい場所を入力。日別ルート、ホテル、食事エリア、空港までを一つのGoogleマップにまとめます。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <><StructuredData locale="ja" /><TripPlannerApp initialLocale="ja" mapsApiKey={process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? ""} /></>;
}
