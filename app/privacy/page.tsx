import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header><p>TRIPCHECK / LEGAL / 001</p><h1>Privacy.</h1><span>Last updated July 20, 2026</span></header>
      <section>
        <h2>The short version</h2>
        <p>Your pasted itinerary is analysed in your browser. TripCheck does not store it in a database or make it available for human review.</p>
      </section>
      <section>
        <h2>Optional live transit</h2>
        <p>If you choose “Update train times,” TripCheck sends only the origin and destination coordinates and planned departure time for each route leg to a protected TripCheck endpoint. That endpoint requests a current route from Google Maps Platform. Your pasted notes, hotel text and reservation descriptions are not included.</p>
        <p>Live route responses are used in memory for the current page and are not stored by TripCheck. Google processes the route request under the <a href="https://policies.google.com/privacy" rel="noreferrer" target="_blank">Google Privacy Policy</a>.</p>
      </section>
      <section>
        <h2>Optional nearby food search</h2>
        <p>If you ask TripCheck to find nearby restaurants, it sends only the suggested area&apos;s coordinates, meal type, interface language and the food phrase you selected to a protected TripCheck endpoint. That endpoint requests nearby restaurant names from Google Maps Platform. The itinerary text, hotel text, dates, reservation details and other trip stops are not included.</p>
        <p>After the Google Maps candidates appear, TripCheck may send only those candidates&apos; names, categories and addresses—plus the selected food phrase, meal type, area and interface language—to Anthropic&apos;s Claude API for a short comparison. Coordinates, itinerary text, hotel text, dates, reservation details and other trip stops are not sent to the AI. Anthropic processes that request under the <a href="https://www.anthropic.com/legal/privacy" rel="noreferrer" target="_blank">Anthropic Privacy Policy</a>.</p>
        <p>Results are held only in memory for the current page and are not stored by TripCheck. If the AI call is unavailable or slow, the Google Maps candidates remain usable in their original order. Links to Tabelog and X open searches on those services; TripCheck does not retrieve, copy or combine their reviews or rankings.</p>
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
