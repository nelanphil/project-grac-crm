import Link from "next/link";
import { COMPANY, ESTIMATE_ROUTE } from "@/lib/constants";

export default function CtaBanner() {
  return (
    <section className="bg-brand-orange py-16">
      <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-white/80">
          Don&apos;t Wait for a Power Outage
        </p>
        <h2 className="mt-2 text-3xl font-bold text-white md:text-4xl">
          Get Reliable Backup Power!
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-white/90">
          Protect your home or business with reliable standby power solutions
          from {COMPANY.name}. From installation to regular maintenance and
          repairs, our certified team ensures you&apos;re always powered up
          when it matters most.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <a
            href={COMPANY.phoneHref}
            className="inline-flex items-center justify-center rounded-full bg-white px-8 py-3 text-sm font-semibold text-brand-orange transition-colors hover:bg-white/90"
          >
            Call {COMPANY.phone}
          </a>
          <Link
            href={ESTIMATE_ROUTE}
            className="inline-flex items-center justify-center rounded-full border-2 border-white px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Get Your Estimate
          </Link>
        </div>
      </div>
    </section>
  );
}
