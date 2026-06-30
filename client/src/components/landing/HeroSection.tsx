import Link from "next/link";
import { COMPANY, ESTIMATE_ROUTE } from "@/lib/constants";

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-brand-midnight text-white">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-midnight via-brand-dark to-black opacity-90" />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 50%, #f36c21 0%, transparent 50%), radial-gradient(circle at 80% 20%, #f36c21 0%, transparent 40%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
            Expert Backup Power
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            with {COMPANY.name}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-white/80 sm:text-xl">
            Florida homeowners and businesses count on us for safe, reliable
            standby generator service. Our certified technicians install
            dependable backup generators and provide 24/7 support across Central
            and South Florida.
          </p>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-white/90">
            <span className="flex items-center gap-2">
              <svg className="h-5 w-5 text-brand-orange" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              {COMPANY.license}
            </span>
            <span className="flex items-center gap-2">
              <svg className="h-5 w-5 text-brand-orange" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              24/7 Emergency Service
            </span>
            <span className="flex items-center gap-2">
              <svg className="h-5 w-5 text-brand-orange" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
              Generac Authorized Dealer
            </span>
          </div>

          <div className="mt-10 flex flex-wrap gap-4">
            <a href={COMPANY.phoneHref} className="btn-primary">
              Call {COMPANY.phone}
            </a>
            <Link href={ESTIMATE_ROUTE} className="btn-secondary">
              Get Your Estimate
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
