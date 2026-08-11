import type { Metadata } from "next";
import StructuredData from "./StructuredData";
import TripPlannerApp from "./TripPlannerApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TripCheck — build a realistic itinerary from saved places",
  description:
    "Drop in the places you want. TripCheck groups them into days, orders the route, suggests a practical base and schedule-checked meal candidates, and checks what actually fits.",
  alternates: { canonical: "/" },
};

// v1.1 TC-018: the chosen language is persisted to localStorage
// ("tripcheck-locale", written by the planner shell) but the bare "/" URL used
// to ignore it — a Japanese traveller reopening the root always got English.
// This inline gate runs during HTML parse, before any content paints and
// before hydration (whose locale effect would overwrite the stored key), so a
// stored "ja" choice lands on /ja without an English flash. /ja stays an
// explicit choice with no gate, and choosing EN in the header stores "en", so
// the redirect can never loop.
const LOCALE_GATE_SCRIPT = 'try{if(localStorage.getItem("tripcheck-locale")==="ja")location.replace("/ja"+location.search+location.hash)}catch(e){}';

export default function Home() {
  return <><script dangerouslySetInnerHTML={{ __html: LOCALE_GATE_SCRIPT }} /><StructuredData locale="en" /><TripPlannerApp initialLocale="en" mapsApiKey={process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? ""} /></>;
}
