import type { Metadata } from "next";
import TermsOfServiceContent from "@/components/legal/TermsOfServiceContent";
import { pageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = pageMetadata({
  title: "Terms of Service",
  description:
    "Terms governing your use of our website, customer portal, and related online services.",
  path: "/terms",
});

export default function TermsPage() {
  return <TermsOfServiceContent />;
}
