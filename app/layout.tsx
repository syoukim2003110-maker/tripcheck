import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource/anton";
import "./base.css";
import "./planner.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "tripcheck-japan-tokyo.syoki.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "TripCheck — build a realistic itinerary from saved places";
  const description = "Drop in the places you want. TripCheck groups them into days, orders the route, suggests a practical base and schedule-checked meal candidates, and checks what actually fits.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "TripCheck",
    category: "travel",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    },
    keywords: [
      "trip itinerary planner",
      "travel route optimizer",
      "itinerary feasibility checker",
      "realistic travel itinerary",
      "minimum trip days calculator",
      "airport itinerary planner",
      "Google Maps itinerary planner",
      "Japan trip planner",
      "Switzerland trip planner",
      "Europe itinerary planner",
    ],
    alternates: {
      canonical: origin,
      languages: {
        "en": `${origin}/`,
        "ja": `${origin}/ja`,
        "x-default": `${origin}/`,
      },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      siteName: "TripCheck",
      locale: "en_US",
      images: [{ url: `${origin}/og-feasibility.png`, width: 1536, height: 1024, alt: "TripCheck turns saved places into a realistic day-by-day itinerary" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og-feasibility.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
