import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header><p>TRIPCHECK / LEGAL / 001</p><h1>Privacy.</h1><span>Last updated July 21, 2026</span></header>
      <section>
        <h2>The short version</h2>
        <p>Your pasted itinerary is analysed in your browser. TripCheck does not store it in a database or make it available for human review.</p>
      </section>
      <section>
        <h2>Planning-time routes</h2>
        <p>Before a dated plan appears, TripCheck automatically sends only the origin and destination coordinates, route mode and planned departure time for each bounded route leg to a protected TripCheck endpoint. That endpoint requests transit or walking duration from Google Maps Platform. Walking requests do not send the departure time onward to Google. Your pasted notes, hotel text and reservation descriptions are not included.</p>
        <p>The browser also sends route coordinates, modes and usable departure times directly to Google Maps Platform to draw the route line after the plan opens. Route responses are used in memory for the current page and are not stored by TripCheck. Google processes these requests under the <a href="https://policies.google.com/privacy" rel="noreferrer" target="_blank">Google Privacy Policy</a>.</p>
      </section>
      <section>
        <h2>Planning-time place, food and hotel checks</h2>
        <p>When you create a plan, unknown place names and the hotel or area text you entered are sent to protected TripCheck endpoints so Google Maps Platform can resolve them. TripCheck then requests current listing fields for the resolved places and nearby food and hotel candidates. Those fields may include public names, addresses, coordinates, opening-hour status, payment options, ratings, photos and a small provider-selected set of attributed Google reviews.</p>
        <p>Google evidence is ranked and converted into schedule constraints by deterministic code. Structured opening periods are checked against each travel date; flexible places may move to an open day, and a place with no usable verified window is left out and disclosed. TripCheck does not send your full itinerary, dates, reservation notes, airport details or completed schedule to an AI.</p>
        <p>Before the schedule appears, TripCheck may send only a resolved place, restaurant or hotel name, its public address or area, interface language and search purpose to Anthropic&apos;s web-search tool. Anthropic may search indexed public sources such as X, Instagram, local news and firsthand blogs. TripCheck accepts only cited source URLs returned by the search, rejects sources verifiably older than 90 days and labels unknown dates instead of presenting them as recent. A quick check is capped at one search, a deeper place or hotel check at two, and one plan is capped at 24 search units.</p>
        <p>Results are held in page memory and are not written to a TripCheck database. To prevent duplicate charges, the public-web result may remain in server memory for up to 30 minutes. If AI search is unavailable or slow, the Google listing and rule-based checks remain usable. Anthropic processes the search under the <a href="https://www.anthropic.com/legal/privacy" rel="noreferrer" target="_blank">Anthropic Privacy Policy</a>.</p>
      </section>
      <section>
        <h2>Device storage</h2>
        <p>The current product stores only your interface language on your device. It does not store itinerary text, live route results, dates or hotel details in browser storage.</p>
      </section>
      <section>
        <h2>Operational data</h2>
        <p>Normal hosting infrastructure may process an IP address and basic request metadata to deliver and protect the service. TripCheck does not intentionally place itinerary content in analytics or application logs.</p>
      </section>
      <section>
        <h2>Contact and changes</h2>
        <p>This early product does not yet create user accounts. This policy will be updated before introducing saved trips, sharing, payments or any AI processing of itinerary text.</p>
      </section>
      <footer><Link href="/">← Return to TripCheck</Link><Link href="/terms">Terms of use →</Link></footer>
    </main>
  );
}
