import type { Metadata } from "next";
import PrivacyPolicyContent from "@/components/legal/PrivacyPolicyContent";
import { pageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "How we collect, use, and protect your information, including phone and SMS communications.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return <PrivacyPolicyContent />;
}
