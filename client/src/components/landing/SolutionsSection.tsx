import Link from "next/link";
import { ESTIMATE_ROUTE } from "@/lib/constants";

export default function SolutionsSection() {
  return (
    <section id="why-us" className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-10 lg:flex-row">
          <div className="flex-1">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
              Why Choose Us
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-brand-dark md:text-4xl">
              For Reliable Backup Power?
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-neutral-600">
              Getting a new generator shouldn&apos;t feel like a big, confusing
              project. Generator Maintenance of Florida walks you through the
              whole process and handles the details — including permits,
              electrical work, plumbing, installation, and final startup.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-neutral-600">
              We also offer flexible payment options and keep you updated
              throughout the project, so you&apos;re never left wondering
              what&apos;s going on.
            </p>
            <Link href={ESTIMATE_ROUTE} className="btn-primary mt-8 inline-flex">
              Get Your Estimate
            </Link>
          </div>

          <div className="flex-1">
            <div className="aspect-[4/3] rounded-lg bg-gradient-to-br from-brand-midnight to-brand-dark p-8 flex flex-col justify-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
                Automatic Transfer to Backup Power
              </p>
              <p className="mt-4 text-xl font-bold text-white">
                Power restored in 10–30 seconds
              </p>
              <p className="mt-3 text-white/70">
                With a Generac home standby generator and automatic transfer
                switch, power is restored within approximately 10 to 30 seconds
                after an outage is detected — whether you&apos;re home or away.
              </p>
              <div className="mt-8 inline-flex rounded-lg bg-white/10 px-6 py-4">
                <span className="text-lg font-semibold text-white">Generac</span>
                <span className="ml-2 text-white/60">Authorized Dealer</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
