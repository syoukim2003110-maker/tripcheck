import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header><p>TRIPCHECK / LEGAL / 002</p><h1>Terms.</h1><span>Last updated August 6, 2026</span></header>
      <section>
        <h2>Planning aid, not a guarantee</h2>
        <p>TripCheck is a travel-planning aid. Estimated routes, schedules, airport buffers, venue information and recommendations can be incomplete or change without notice. Confirm important details with the relevant transport operator, venue, airline or official source.</p>
      </section>
      <section>
        <h2>Google Maps content</h2>
        <p>Live public-transport results and Google Maps links are provided using Google Maps Platform. Your use of those features is also subject to the <a href="https://maps.google.com/help/terms_maps/" rel="noreferrer" target="_blank">Google Maps/Google Earth Additional Terms</a> and the <a href="https://policies.google.com/terms" rel="noreferrer" target="_blank">Google Terms of Service</a>.</p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>Do not use the service to overload, probe or bypass its limits, resell provider data, automate bulk route extraction or interfere with other travellers’ access.</p>
      </section>
      <section>
        <h2>Availability</h2>
        <p>The product is an early worldwide beta with deeper local support for a curated set of countries. It may change, pause or remove prototype features. It does not yet optimize flights, ferries, border crossings or multi-time-zone travel between countries. Where live data is unavailable, TripCheck falls back to clearly labelled planning estimates.</p>
      </section>
      <footer><Link href="/">← Return to TripCheck</Link><Link href="/privacy">Privacy →</Link></footer>
    </main>
  );
}
