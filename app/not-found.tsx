import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div className="not-found-mark" aria-hidden="true"><i /><i /></div>
      <p>TRIPCHECK / TOKYO / 404</p>
      <h1><span>THIS ROUTE</span><strong>DOESN&apos;T WORK.</strong></h1>
      <Link href="/">Return to the trip builder <span>↗</span></Link>
    </main>
  );
}
