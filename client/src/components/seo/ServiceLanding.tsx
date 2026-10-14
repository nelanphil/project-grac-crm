import Link from "next/link";
import FaqSection from "@/components/landing/FaqSection";
import LocalPage from "@/components/seo/LocalPage";
import { getCity } from "@/lib/seo/catalog";
import { SERVICE_PAGES, type ServicePage } from "@/lib/seo/services";
import { citySlug, faqPageJsonLd, localBusinessJsonLd } from "@/lib/seo/site";
import {
  formatRegionPhrase,
  getPublicServiceAreas,
  landingFaqs,
  type PublicServiceArea,
} from "@/lib/serviceAreas";

export default async function ServiceLanding({
  service,
}: {
  service: ServicePage;
}) {
  const areas = await getPublicServiceAreas();
  const phrase = formatRegionPhrase(areas.map((area) => area.name));
  const faqs = landingFaqs(phrase);
  const otherServices = SERVICE_PAGES.filter((item) => item.slug !== service.slug);
  const columns =
    areas.length >= 3
      ? "md:grid-cols-2 lg:grid-cols-3"
      : areas.length === 2
        ? "md:grid-cols-2"
        : "";

  return (
    <LocalPage
      eyebrow={service.eyebrow}
      h1={service.h1}
      lede={service.lede}
      jsonLd={[
        localBusinessJsonLd({ name: "Florida", type: "State" }),
        faqPageJsonLd(faqs),
      ]}
    >
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-4 text-lg leading-relaxed text-neutral-600">
            {service.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <h2 className="mt-12 text-2xl font-bold text-brand-dark">
            {service.includesTitle}
          </h2>
          <ul className="mt-6 max-w-3xl list-disc space-y-3 pl-5 text-neutral-600">
            {service.includes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <h2 className="mt-12 text-2xl font-bold text-brand-dark">
            Related generator services
          </h2>
          <ul className="mt-6 flex flex-col gap-3">
            {otherServices.map((item) => (
              <li key={item.slug}>
                <Link
                  href={item.path}
                  className="font-semibold text-brand-dark underline-offset-2 hover:text-brand-orange hover:underline"
                >
                  {item.h1}
                </Link>
              </li>
            ))}
          </ul>

          <h2 className="mt-12 text-2xl font-bold text-brand-dark">
            Generator service by city
          </h2>
          <p className="mt-3 max-w-3xl text-neutral-600">
            Cities we serve in {phrase}. A city with its own page links through.
          </p>
          {areas.length > 0 ? (
            <div className={`mt-8 grid grid-cols-1 gap-10 ${columns}`}>
              {areas.map((area) => (
                <CityLinkList key={area.id || area.name} area={area} />
              ))}
            </div>
          ) : null}
        </div>
      </section>
      <FaqSection faqs={faqs} />
    </LocalPage>
  );
}

function CityLinkList({ area }: { area: PublicServiceArea }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-brand-dark">{area.name}</h3>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {area.cities.map((city) => {
          const page = getCity(citySlug(city.name));
          return (
            <li key={city.name}>
              {page ? (
                <Link
                  href={page.path}
                  className="text-neutral-600 underline-offset-2 hover:text-brand-orange hover:underline"
                >
                  {city.name}
                </Link>
              ) : (
                <span className="text-neutral-600">{city.name}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
