import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CityLanding from "@/components/seo/CityLanding";
import { CITY_PAGES, getCity } from "@/lib/seo/catalog";
import { pageMetadata } from "@/lib/seo/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return CITY_PAGES.map((city) => ({ city: city.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) return {};
  return pageMetadata({
    title: city.title,
    description: city.description,
    path: city.path,
  });
}

export default async function CityServicePage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) notFound();
  return <CityLanding city={city} />;
}
