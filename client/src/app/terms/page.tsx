import type { Metadata } from "next";
import TermsOfServiceContent from "@/components/legal/TermsOfServiceContent";
import { COMPANY } from "@/lib/constants";

export const metadata: Metadata = {
  title: `Terms of Service — ${COMPANY.name}`,
  description:
    "Terms governing your use of our website, customer portal, and related online services.",
};

export default function TermsPage() {
  return <TermsOfServiceContent />;
}
