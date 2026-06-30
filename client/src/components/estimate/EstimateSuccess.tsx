import Link from "next/link";
import { COMPANY } from "@/lib/constants";

export default function EstimateSuccess() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-100 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="mt-6 text-3xl font-bold text-brand-dark">
          Thank You!
        </h1>
        <p className="mt-4 text-lg text-neutral-600">
          Your estimate request has been submitted. A member of the{" "}
          {COMPANY.name} team will contact you shortly.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/" className="btn-primary">
            Back to Home
          </Link>
          <a href={COMPANY.phoneHref} className="btn-outline-dark">
            Call {COMPANY.phone}
          </a>
        </div>
      </div>
    </div>
  );
}
