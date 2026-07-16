import type { Metadata } from "next";
import StructuredData from "../StructuredData";
import TripCheckApp from "../TripCheckApp";

export const metadata: Metadata = {
  title: "도쿄 일정 검사기 | TripCheck Japan",
  description: "도쿄 일정이 실제로 가능한지 확인하고 무리한 이동, 불안정한 예약과 빽빽한 하루를 찾아 설명 가능한 수정안을 받으세요.",
  alternates: { canonical: "/ko" },
};

export default function KoreanHome() {
  return <><StructuredData locale="ko" /><TripCheckApp initialLocale="ko" /></>;
}
