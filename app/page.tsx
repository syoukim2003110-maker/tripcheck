import type { Metadata } from "next";
import StructuredData from "./StructuredData";
import TripCheckApp from "./TripCheckApp";

export const metadata: Metadata = {
  title: "Tokyo Itinerary Checker | TripCheck Japan",
  description:
    "Check whether your Tokyo itinerary works in reality. Find impossible travel, fragile reservations and exhausting days, then get an explainable revision.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return <><StructuredData locale="en" /><TripCheckApp initialLocale="en" /></>;
}
