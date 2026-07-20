import type { Metadata } from "next";
import StructuredData from "./StructuredData";
import TripPlannerApp from "./TripPlannerApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TripCheck — Japan trip planner",
  description:
    "Add places anywhere in Japan. See each day's route, hotel base and meal areas together on one Google map.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return <><StructuredData locale="en" /><TripPlannerApp initialLocale="en" mapsApiKey={process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? ""} /></>;
}
