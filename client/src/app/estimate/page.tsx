import type { Metadata } from "next";
import EstimateWizard from "@/components/estimate/EstimateWizard";
import { pageMetadata } from "@/lib/seo/site";

export const metadata: Metadata = pageMetadata({
  title: "Free Estimate",
  description:
    "Request a free standby generator estimate for your home or business in Central and South Florida.",
  path: "/estimate",
});

export default function EstimatePage() {
  return <EstimateWizard />;
}
