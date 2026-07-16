import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist_Mono } from "next/font/google";
import "@fontsource/archivo-black/latin-400.css";
import "@fontsource/dela-gothic-one/latin-400.css";
import "@fontsource/dela-gothic-one/japanese-400.css";
import "@fontsource/noto-sans-jp/latin-400.css";
import "@fontsource/noto-sans-jp/japanese-400.css";
import "@fontsource/noto-sans-jp/latin-700.css";
import "@fontsource/noto-sans-jp/japanese-700.css";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "tripcheck-japan-tokyo.syoki.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Tokyo Itinerary Checker | TripCheck Japan";
  const description = "Paste a Tokyo itinerary and check whether its order, travel time and fixed reservations work in reality. Find conflicts and get a calmer, explainable revision.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    applicationName: "TripCheck Japan",
    category: "travel",
    keywords: [
      "Tokyo itinerary checker",
      "Japan trip planner",
      "AI itinerary reality check",
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
      images: [{ url: `${origin}/og-cinema-v1.png`, width: 1536, height: 1024, alt: "TripCheck Japan — Tokyo itinerary reality check" }],
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
      <body className={geistMono.variable}>
        {children}
      </body>
    </html>
  );
}
