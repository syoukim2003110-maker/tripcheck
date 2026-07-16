import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripCheckApp from "../TripCheckApp";

export const metadata: Metadata = {
  title: "东京行程检查器 | TripCheck Japan",
  description: "检查东京行程是否能在现实中执行，找出不合理移动、脆弱预约和过度安排，并获得带解释的修改方案。",
  alternates: { canonical: "/zh" },
};

export default function ChineseHome() {
  return <><StructuredData locale="zh" /><TripCheckApp initialLocale="zh" /></>;
}
