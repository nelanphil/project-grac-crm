import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import SolutionsSection from "@/components/landing/SolutionsSection";
import BrandsSection from "@/components/landing/BrandsSection";
import SystemIncludesSection from "@/components/landing/SystemIncludesSection";
import FaqSection from "@/components/landing/FaqSection";
import ServiceAreasSection from "@/components/landing/ServiceAreasSection";
import CtaBanner from "@/components/landing/CtaBanner";

export default function Home() {
  return (
    <>
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
