import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource/anton/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";
import "./planner.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "tripcheck-japan-tokyo.syoki.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "TripCheck — Japan trip planner";
  const description = "Add places in any order. TripCheck groups each day, draws the route on Google Maps and keeps nearby food options in one workspace.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "TripCheck Japan",
    category: "travel",
    keywords: [
      "Japan itinerary planner",
      "Japan trip builder",
      "Japan route optimizer",
      "Japan sightseeing route planner",
      "Japan itinerary generator",
      "best area to stay in Japan",
      "Japan hotel location planner",
      "Japan airport itinerary planner",
      "Japan trip planner",
      "Japan travel planning",
      "Google Maps itinerary Japan",
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
      siteName: "TripCheck Japan",
      locale: "en_US",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "TripCheck Japan — 日本を、ひとつの地図で。" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
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
