import { SYSTEM_INCLUDES, UPGRADES } from "@/lib/constants";

export default function SystemIncludesSection() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="section-heading">Every Generator System Includes</h2>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {SYSTEM_INCLUDES.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-neutral-200 p-8"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="mt-6 text-lg font-bold text-brand-dark">
                {item.title}
              </h3>
              <p className="mt-3 text-neutral-600">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-20">
          <h3 className="text-center text-2xl font-bold text-brand-dark">
            Recommended Generator Upgrades
          </h3>
          <div className="mx-auto mt-10 max-w-3xl">
            {UPGRADES.map((upgrade) => (
              <div
                key={upgrade.title}
                className="rounded-lg bg-brand-midnight p-8 text-white"
              >
                <h4 className="text-xl font-bold">{upgrade.title}</h4>
                <p className="mt-4 text-white/80">{upgrade.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
