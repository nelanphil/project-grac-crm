import type { Metadata } from "next";
import EstimateWizard from "@/components/estimate/EstimateWizard";
import { COMPANY } from "@/lib/constants";

export const metadata: Metadata = {
  title: `Get Your Free Estimate — ${COMPANY.name}`,
  description:
    "Request a free standby generator estimate for your home or business in Central and South Florida.",
};

export default function EstimatePage() {
  return <EstimateWizard />;
}
