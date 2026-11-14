import type { Metadata } from "next";
import ShioriApp from "../shiori/ShioriApp";
import "../shiori/shiori.css";

export const metadata: Metadata = {
  title: "TripCheck — 旅行の予定をつくる",
  description: "行きたい場所・お店・ホテルを選んで、旅行の予定を作成。日ごとの移動時間とルートを地図で確認できます。無料・登録なし。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <div lang="ja"><ShioriApp locale="ja" /></div>;
}
