import Link from "next/link";
import { ESTIMATE_ROUTE, GENERAC_HOME_STANDBY } from "@/lib/constants";
import GeneracHowItWorks from "./GeneracHowItWorks";

export default function BrandsSection() {
  return (
    <section id="generac" className="bg-neutral-100 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
            Guaranteed Peace of Mind
          </p>
          <h2 className="section-heading mt-2">Never Lose Power</h2>
          <p className="section-subheading mx-auto max-w-3xl">
            {GENERAC_HOME_STANDBY.overview}
          </p>
        </div>

        <div className="mt-16 rounded-lg bg-white p-8 shadow-sm md:p-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
                Our Product Partner
              </p>
              <h3 className="mt-2 text-2xl font-bold text-brand-dark md:text-3xl">
                Generac Home Standby Generators
              </h3>
              <p className="mt-3 max-w-2xl text-neutral-600">
                Founded in 1959, Generac created the home standby generator
                category and remains the #1 manufacturer of home backup power in
                North America — trusted by Florida homeowners through hurricanes,
                storms, and everyday grid disruptions.
              </p>
            </div>
            <a
              href={GENERAC_HOME_STANDBY.learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline-dark shrink-0 self-start md:self-center"
            >
              Learn More at Generac.com
            </a>
          </div>
        </div>

        <GeneracHowItWorks />

        <div className="mt-16">
          <h3 className="text-center text-2xl font-bold text-brand-dark">
            When You Choose Generac, You Choose Peace of Mind
          </h3>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {GENERAC_HOME_STANDBY.benefits.map((benefit) => (
              <div
                key={benefit.title}
                className="rounded-lg border border-neutral-200 bg-white p-8"
              >
                <h4 className="text-lg font-bold text-brand-dark">
                  {benefit.title}
                </h4>
                <p className="mt-3 text-neutral-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 rounded-lg bg-brand-midnight p-8 text-white md:p-10">
          <h3 className="text-xl font-bold">Maintenance &amp; Ownership</h3>
          <p className="mt-4 max-w-3xl text-white/80">
            {GENERAC_HOME_STANDBY.maintenanceNote}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href={ESTIMATE_ROUTE} className="btn-primary">
              Get Your Estimate
            </Link>
            <Link href="/#services" className="btn-secondary">
              View Our Services
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
