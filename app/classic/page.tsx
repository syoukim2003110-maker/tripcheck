import type { Metadata } from "next";
import { browserGoogleMapsApiKey } from "../../lib/browser-map-provider";
import StructuredData from "../StructuredData";
import TripPlannerApp from "../TripPlannerApp";

export const metadata: Metadata = {
  title: "TripCheck — build a realistic itinerary from saved places",
  description:
    "Drop in the places you want. TripCheck groups them into days, orders the route, suggests a practical base and schedule-checked meal candidates, and checks what actually fits.",
  alternates: { canonical: "/classic" },
};

export default function Home() {
  return <><StructuredData locale="en" /><TripPlannerApp initialLocale="en" mapsApiKey={browserGoogleMapsApiKey()} /></>;
}
