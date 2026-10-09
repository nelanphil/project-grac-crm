import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import CrashBoundary from "@/components/crash/CrashBoundary";
import SiteChrome from "@/components/layout/SiteChrome";
import { COMPANY } from "@/lib/constants";
import {
  OG_IMAGE,
  PUBLIC_SITE_URL,
  ROOT_DESCRIPTION,
  ROOT_TITLE,
  TITLE_TEMPLATE,
} from "@/lib/seo/site";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  title: {
    default: ROOT_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: ROOT_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: COMPANY.name,
    title: ROOT_TITLE,
    description: ROOT_DESCRIPTION,
    url: "/",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: ROOT_TITLE,
    description: ROOT_DESCRIPTION,
    images: [OG_IMAGE],
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
