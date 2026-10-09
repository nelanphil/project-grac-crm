import Link from "next/link";
import LocalPage from "@/components/seo/LocalPage";
import { getCity, type CityPage } from "@/lib/seo/catalog";
import { SERVICE_PAGES } from "@/lib/seo/services";
import { localBusinessJsonLd } from "@/lib/seo/site";

export default function CityLanding({ city }: { city: CityPage }) {
  const nearby = city.nearby
    .map((slug) => getCity(slug))
    .filter((item): item is CityPage => Boolean(item));

  return (
    <LocalPage
      eyebrow={`${city.region} · Generator Maintenance of Florida`}
      h1={city.h1}
      lede={city.lede}
      jsonLd={[localBusinessJsonLd({ name: city.name, type: "City" })]}
    >
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-4 text-lg leading-relaxed text-neutral-600">
            {city.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <h2 className="mt-12 text-2xl font-bold text-brand-dark">
            {city.notesTitle}
          </h2>
          <ul className="mt-6 max-w-3xl list-disc space-y-3 pl-5 text-neutral-600">
            {city.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>

          <h2 className="mt-12 text-2xl font-bold text-brand-dark">
            Services in {city.name}
          </h2>
          <ul className="mt-6 flex flex-col gap-3">
            {SERVICE_PAGES.map((service) => (
              <li key={service.slug}>
                <Link
                  href={service.path}
                  className="font-semibold text-brand-dark underline-offset-2 hover:text-brand-orange hover:underline"
                >
                  {service.title} in {city.name}
                </Link>
              </li>
            ))}
          </ul>

          <h2 className="mt-12 text-2xl font-bold text-brand-dark">
            Nearby cities
          </h2>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
            {nearby.map((item) => (
              <li key={item.slug}>
                <Link
                  href={item.path}
                  className="text-neutral-600 underline-offset-2 hover:text-brand-orange hover:underline"
                >
                  Generac generator service in {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </LocalPage>
  );
}
