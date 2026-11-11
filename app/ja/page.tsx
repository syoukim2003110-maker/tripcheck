import type { Metadata } from "next";
import ShioriApp from "../shiori/ShioriApp";
import "../shiori/shiori.css";

export const metadata: Metadata = {
  title: "TripCheck — 行きたい場所を選ぶだけで、旅のしおりができる",
  description: "行き先を選んで、行きたい場所をタップするだけ。どの日にどこを、どの順番で、どの電車で回るか。ホテルとごはんの候補まで、地図と一緒にまとめます。無料・登録なし。",
  alternates: { canonical: "/ja" },
};

export default function JapaneseHome() {
  return <div lang="ja"><ShioriApp locale="ja" /></div>;
}
