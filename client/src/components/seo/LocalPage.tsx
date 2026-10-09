import Link from "next/link";
import type { ReactNode } from "react";
import CtaBanner from "@/components/landing/CtaBanner";
import JsonLd from "@/components/seo/JsonLd";
import { COMPANY, ESTIMATE_ROUTE } from "@/lib/constants";

export default function LocalPage({
  eyebrow,
  h1,
  lede,
  jsonLd,
  children,
}: {
  eyebrow: string;
  h1: string;
  lede: string;
  jsonLd: readonly unknown[];
  children: ReactNode;
}) {
  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
      <section className="bg-brand-midnight text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">
            {eyebrow}
          </p>
          <h1 className="mt-3 max-w-4xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            {h1}
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/80">
            {lede}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a href={COMPANY.phoneHref} className="btn-primary">
              Call {COMPANY.phone}
            </a>
            <Link href={ESTIMATE_ROUTE} className="btn-secondary">
              Get Your Estimate
            </Link>
          </div>
          <p className="mt-6 text-sm text-white/70">
            <a
              href={`mailto:${COMPANY.email}`}
              className="underline-offset-2 hover:underline"
            >
              {COMPANY.email}
            </a>
          </p>
        </div>
      </section>
      {children}
      <CtaBanner />
    </>
  );
}
