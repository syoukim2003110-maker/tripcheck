import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource/anton/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "tripcheck-japan-tokyo.syoki.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Tokyo Trip Builder & Route Optimizer | TripCheck Japan";
  const description = "Add the Tokyo places you want, your hotel and flights. Get a day-by-day route with hotel-area recommendations, transport choices and airport deadlines.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "TripCheck Japan",
    category: "travel",
    keywords: [
      "Tokyo itinerary checker",
      "Tokyo trip builder",
      "Tokyo route optimizer",
      "Tokyo sightseeing route planner",
      "Tokyo itinerary generator",
      "best area to stay in Tokyo",
      "Tokyo hotel location planner",
      "Tokyo airport itinerary planner",
      "Japan trip planner",
      "Tokyo travel planning",
      "Tokyo itinerary review",
    ],
    alternates: {
      canonical: origin,
      languages: {
        "en": `${origin}/`,
        "ja": `${origin}/ja`,
        "ko": `${origin}/ko`,
        "zh-CN": `${origin}/zh`,
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
      images: [{ url: `${origin}/og-cinema-v1.png`, width: 1536, height: 1024, alt: "TripCheck Japan — turn Tokyo places into a calmer route" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og-cinema-v1.png`],
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
