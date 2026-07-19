import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripCheckApp from "../TripCheckApp";

export const metadata: Metadata = {
  title: "东京旅行自动规划与路线优化 | TripCheck Japan",
  description: "输入东京地点、酒店和航班，生成每日路线、住宿区域比较、交通方式以及前往机场的截止时间。",
  alternates: { canonical: "/zh" },
};

export default function ChineseHome() {
  return <><StructuredData locale="zh" /><TripCheckApp initialLocale="zh" /></>;
}
