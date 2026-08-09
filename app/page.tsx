import type { Metadata } from "next";
import StructuredData from "./StructuredData";
import TripPlannerApp from "./TripPlannerApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TripCheck — itinerary feasibility checker",
  description:
    "Paste your saved places. TripCheck checks routes, opening hours, bookings, airports and usable time to show what actually fits.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return <><StructuredData locale="en" /><TripPlannerApp initialLocale="en" mapsApiKey={process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? ""} /></>;
}
