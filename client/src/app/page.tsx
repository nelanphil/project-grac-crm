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
import { faqPageJsonLd, localBusinessJsonLd } from "@/lib/seo/site";
import {
  formatRegionPhrase,
  getPublicServiceAreas,
  landingFaqs,
} from "@/lib/serviceAreas";

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const areas = await getPublicServiceAreas();
  const phrase = formatRegionPhrase(areas.map((area) => area.name));
  return {
    title: `Generator Service in ${phrase}`,
    description: `Generac installation, maintenance, and 24/7 repair across ${phrase}. Call (386) 631-8982.`,
    alternates: { canonical: "/" },
  };
}

export default async function Home() {
  const areas = await getPublicServiceAreas();
  const phrase = formatRegionPhrase(areas.map((area) => area.name));
  const faqs = landingFaqs(phrase);

  return (
    <>
      <JsonLd data={localBusinessJsonLd({ name: "Florida", type: "State" })} />
      <JsonLd data={faqPageJsonLd(faqs)} />
      <HomeAuthRedirect />
      <HeroSection regionPhrase={phrase} />
      <FeaturesSection regionPhrase={phrase} />
      <SolutionsSection />
      <BrandsSection />
      <SystemIncludesSection />
      <FaqSection faqs={faqs} />
      <ServiceAreasSection />
      <CtaBanner />
    </>
  );
}
