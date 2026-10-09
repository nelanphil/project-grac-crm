import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import CrashBoundary from "@/components/crash/CrashBoundary";
import SiteChrome from "@/components/layout/SiteChrome";
import "./globals.css";

/** Runs in <head> before paint. Keep in sync with client/src/lib/theme.ts. */
const themeInitScript = `(function(){try{if(location.pathname.indexOf("/dashboard")!==0)return;var t=localStorage.getItem("grac-theme");if(t==="light")return;if(t==="dark"){document.documentElement.setAttribute("data-theme","dark");return;}var raw=localStorage.getItem("grac-auth");if(!raw)return;var parsed=JSON.parse(raw);var state=parsed&&parsed.state;if(state&&state.isAuthenticated&&state.token){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`;

/**
 * Runs in <head> before paint. Logged-in visitors opening the public homepage
 * go to the dashboard (or legal consent) instead of the marketing page.
 * Client navigations are handled by HomeAuthRedirect.
 */
const homeAuthRedirectScript = `(function(){try{var path=location.pathname;if(path.length>1&&path.charAt(path.length-1)==="/")path=path.slice(0,-1);if(path!==""&&path!=="/")return;var raw=localStorage.getItem("grac-auth");if(!raw)return;var parsed=JSON.parse(raw);var state=parsed&&parsed.state;if(!state||!state.isAuthenticated||!state.token)return;var user=state.user;var needs=!!(user&&user.needsLegalConsent===true);location.replace(needs?"/auth/legal-consent/":"/dashboard/");}catch(e){}})();`;

/** Runs in <head> before paint. Keep in sync with SiteChrome. */
const uiScaleInitScript = `(function(){try{var path=location.pathname;if(path.length>1&&path.charAt(path.length-1)==="/")path=path.slice(0,-1);if(path===""||path==="/")return;document.documentElement.setAttribute("data-ui-scale","compact");}catch(e){}})();`;

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: homeAuthRedirectScript }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: uiScaleInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <CrashBoundary>
          <SiteChrome>{children}</SiteChrome>
        </CrashBoundary>
      </body>
    </html>
  );
}
