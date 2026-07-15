import type { Metadata } from "next";
import TripCheckApp from "./TripCheckApp";

export const metadata: Metadata = {
  title: "TripCheck Japan — AI Itinerary Reality Check",
  description:
    "Paste your Tokyo itinerary. Find impossible jumps, fragile reservations, and exhausting days, then rebuild it around reality.",
};

export default function Home() {
  return <TripCheckApp />;
}
