import Link from "next/link";
import FaqSection from "@/components/landing/FaqSection";
import LocalPage from "@/components/seo/LocalPage";
import { FAQS } from "@/lib/constants";
import { CITY_PAGES } from "@/lib/seo/catalog";
import { SERVICE_PAGES, type ServicePage } from "@/lib/seo/services";
import { faqPageJsonLd, localBusinessJsonLd } from "@/lib/seo/site";

export default function ServiceLanding({ service }: { service: ServicePage }) {
  const otherServices = SERVICE_PAGES.filter((item) => item.slug !== service.slug);
  const central = CITY_PAGES.filter((city) => city.region === "Central Florida");
  const south = CITY_PAGES.filter((city) => city.region === "South Florida");

  return (
    <LocalPage
      eyebrow={service.eyebrow}
      h1={service.h1}
      lede={service.lede}
      jsonLd={[
        localBusinessJsonLd({ name: "Florida", type: "State" }),
        faqPageJsonLd(FAQS),
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
            Each city has its own page for generator service and Generac
            generator service in that place.
          </p>
          <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-2">
            <CityLinkList title="Central Florida" cities={central} />
            <CityLinkList title="South Florida" cities={south} />
          </div>
        </div>
      </section>
      <FaqSection />
    </LocalPage>
  );
}

function CityLinkList({
  title,
  cities,
}: {
  title: string;
  cities: readonly { slug: string; name: string; path: string }[];
}) {
  return (
    <div>
      <h3 className="text-lg font-bold text-brand-dark">{title}</h3>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {cities.map((city) => (
          <li key={city.slug}>
            <Link
              href={city.path}
              className="text-neutral-600 underline-offset-2 hover:text-brand-orange hover:underline"
            >
              {city.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
