import type { Metadata } from "next";
import StructuredData from "./StructuredData";
import TripCheckApp from "./TripCheckApp";

export const metadata: Metadata = {
  title: "Tokyo Trip Builder & Route Optimizer | TripCheck Japan",
  description:
    "Add the Tokyo places you want, your hotel and flights. Get a day-by-day route with hotel-area recommendations, transport choices and airport deadlines.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return <><StructuredData locale="en" /><TripCheckApp initialLocale="en" /></>;
}
