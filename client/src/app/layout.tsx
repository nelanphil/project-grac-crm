import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import CookieConsentBanner from "@/components/legal/CookieConsentBanner";
import ScrollToTopButton from "@/components/ui/ScrollToTopButton";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3009";
const ogImage = {
  url: "/images/generac-product-lineup.jpg",
  width: 1024,
  height: 340,
  type: "image/jpeg",
  alt: "Generac home standby and portable generators",
} as const;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Generator Maintenance of Florida — Expert Backup Power",
  description:
    "Licensed Generac home standby generator installation, maintenance, and 24/7 emergency repair for Central and South Florida.",
  openGraph: {
    type: "website",
    title: "Generator Maintenance of Florida, LLC",
    description:
      "Licensed Generac home standby generator installation, maintenance, and 24/7 emergency repair for Central and South Florida.",
    url: "/",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Generator Maintenance of Florida, LLC",
    description:
      "Licensed Generac home standby generator installation, maintenance, and 24/7 emergency repair for Central and South Florida.",
    images: [ogImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <CookieConsentBanner />
        <ScrollToTopButton />
      </body>
    </html>
  );
}
