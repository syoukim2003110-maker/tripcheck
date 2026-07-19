import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripCheckApp from "../TripCheckApp";

export const metadata: Metadata = {
  title: "도쿄 여행 자동 일정 및 경로 최적화 | TripCheck Japan",
  description: "도쿄 장소, 호텔과 항공편을 입력하면 날짜별 경로, 숙박 지역 비교, 이동수단과 공항 출발 마감까지 한 번에 만듭니다.",
  alternates: { canonical: "/ko" },
};

export default function KoreanHome() {
  return <><StructuredData locale="ko" /><TripCheckApp initialLocale="ko" /></>;
}
