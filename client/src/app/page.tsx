import type { Metadata } from "next";
import HomeAuthRedirect from "@/components/auth/HomeAuthRedirect";
import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import SolutionsSection from "@/components/landing/SolutionsSection";
import BrandsSection from "@/components/landing/BrandsSection";
import SystemIncludesSection from "@/components/landing/SystemIncludesSection";
import FaqSection from "@/components/landing/FaqSection";
import ServiceAreasSection from "@/components/landing/ServiceAreasSection";
import CtaBanner from "@/components/landing/CtaBanner";
import JsonLd from "@/components/seo/JsonLd";
import { FAQS } from "@/lib/constants";
import { faqPageJsonLd, localBusinessJsonLd } from "@/lib/seo/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      <JsonLd data={localBusinessJsonLd({ name: "Florida", type: "State" })} />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      <HomeAuthRedirect />
      <HeroSection />
      <FeaturesSection />
      <SolutionsSection />
      <BrandsSection />
      <SystemIncludesSection />
      <FaqSection />
      <ServiceAreasSection />
      <CtaBanner />
    </>
  );
}
