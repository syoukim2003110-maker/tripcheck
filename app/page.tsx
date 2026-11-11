import type { Metadata } from "next";
import { browserGoogleMapsApiKey } from "../lib/browser-map-provider";
import StructuredData from "./StructuredData";
import TripPlannerApp from "./TripPlannerApp";

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
// A first visit has no stored choice yet; a browser set to Japanese gets the
// Japanese planner rather than an English page it has to find the switch on.
const LOCALE_GATE_SCRIPT = 'try{var l=localStorage.getItem("tripcheck-locale");if(l==="ja"||(!l&&/^ja\\b/i.test(navigator.language||"")))location.replace("/ja/"+location.search+location.hash)}catch(e){}';

export default function Home() {
  return <><script dangerouslySetInnerHTML={{ __html: LOCALE_GATE_SCRIPT }} /><StructuredData locale="en" /><TripPlannerApp initialLocale="en" mapsApiKey={browserGoogleMapsApiKey()} /></>;
}
