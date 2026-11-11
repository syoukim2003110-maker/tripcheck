import type { Metadata } from "next";
import ShioriApp from "./shiori/ShioriApp";
import "./shiori/shiori.css";

export const metadata: Metadata = {
  title: "TripCheck — pick places, get a day-by-day trip booklet",
  description: "Choose a destination and tap the places you want. TripCheck works out which day, what order and how to get between them — with train lines, hotel and meal ideas — on a map. Free, no account.",
  alternates: { canonical: "/" },
};

// A first visit has no stored choice yet; a browser set to Japanese gets the
// Japanese booklet. A stored choice always wins, so the redirect cannot loop:
// choosing EN stores "en".
const LOCALE_GATE_SCRIPT = 'try{var l=localStorage.getItem("tripcheck-locale");if(l==="ja"||(!l&&/^ja\\b/i.test(navigator.language||"")))location.replace("/ja/"+location.search+location.hash)}catch(e){}';

export default function Home() {
  return <><script dangerouslySetInnerHTML={{ __html: LOCALE_GATE_SCRIPT }} /><ShioriApp locale="en" /></>;
}
