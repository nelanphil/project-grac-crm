import type { Metadata } from "next";
import PrivacyPolicyContent from "@/components/legal/PrivacyPolicyContent";
import { COMPANY } from "@/lib/constants";

export const metadata: Metadata = {
  title: `Privacy Policy — ${COMPANY.name}`,
  description:
    "How we collect, use, and protect your information, including phone and SMS communications.",
};

export default function PrivacyPage() {
  return <PrivacyPolicyContent />;
}
