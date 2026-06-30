import { SERVICE_AREAS } from "@/lib/constants";

export default function ServiceAreasSection() {
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
            throughout Central and South Florida.
          </p>
        </div>

        <div className="mt-16 grid gap-12 md:grid-cols-2">
          <div>
            <h3 className="text-lg font-bold text-brand-dark">
              Central Florida
            </h3>
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
              {SERVICE_AREAS.central.map((city) => (
                <li key={city} className="text-neutral-600">
                  {city}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-bold text-brand-dark">
              South Florida
            </h3>
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
              {SERVICE_AREAS.south.map((city) => (
                <li key={city} className="text-neutral-600">
                  {city}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
