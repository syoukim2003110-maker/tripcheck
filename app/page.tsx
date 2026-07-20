import type { Metadata } from "next";
import StructuredData from "./StructuredData";
import TripCheckApp from "./TripCheckApp";

export const metadata: Metadata = {
  title: "Japan Trip Planner & Google Maps Itinerary | TripCheck Japan",
  description:
    "Add places anywhere in Japan. See each day's route, hotel base and meal areas together on one Google map.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return <><StructuredData locale="en" /><TripCheckApp initialLocale="en" /></>;
}
