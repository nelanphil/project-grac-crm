import Link from "next/link";
import { getCity } from "@/lib/seo/catalog";
import { citySlug } from "@/lib/seo/site";
import {
  formatRegionPhrase,
  getPublicServiceAreas,
  type PublicServiceArea,
} from "@/lib/serviceAreas";

export default async function ServiceAreasSection() {
  const areas = await getPublicServiceAreas();
  const phrase = formatRegionPhrase(areas.map((area) => area.name));
  const columns =
    areas.length >= 3
      ? "md:grid-cols-2 lg:grid-cols-3"
      : areas.length === 2
        ? "md:grid-cols-2"
        : "max-w-xl mx-auto";

  return (
    <section id="service-areas" className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
            Where We Work
          </p>
          <h2 className="section-heading mt-2">Service Areas</h2>
          <p className="section-subheading mx-auto max-w-2xl">
            Professional generator installation, maintenance, and repair
            throughout {phrase}.
          </p>
        </div>

        {areas.length > 0 ? (
          <div className={`mt-16 grid grid-cols-1 gap-12 ${columns}`}>
            {areas.map((area) => (
              <AreaColumn key={area.id || area.name} area={area} />
            ))}
          </div>
        ) : (
          <p className="mx-auto mt-16 max-w-xl text-center text-neutral-600">
            Call us to confirm we cover your city.
          </p>
        )}
      </div>
    </section>
  );
}

function AreaColumn({ area }: { area: PublicServiceArea }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-brand-dark">{area.name}</h3>
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
        {area.cities.map((city) => (
          <li key={city.name}>
            <CityName name={city.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CityName({ name }: { name: string }) {
  const page = getCity(citySlug(name));
  if (!page) {
    return <span className="text-neutral-600">{name}</span>;
  }
  return (
    <Link
      href={page.path}
      className="text-neutral-600 underline-offset-2 hover:text-brand-orange hover:underline"
    >
      {name}
    </Link>
  );
}
