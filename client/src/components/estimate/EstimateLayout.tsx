import Link from "next/link";
import { COMPANY } from "@/lib/constants";

interface EstimateLayoutProps {
  step: number;
  totalSteps: number;
  children: React.ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showNav?: boolean;
}

export default function EstimateLayout({
  step,
  totalSteps,
  children,
  onPrevious,
  onNext,
  nextLabel = "Next step",
  nextDisabled = false,
  showNav = true,
}: EstimateLayoutProps) {
  const progress = (step / totalSteps) * 100;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-100 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 text-sm text-neutral-600">
          <Link href="/" className="hover:text-brand-orange">
            Home
          </Link>
          <span className="mx-2">&gt;</span>
          <span className="text-brand-dark">Get an Estimate</span>
        </nav>

        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex items-center">
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              <span className="text-brand-midnight">Get Your</span>
              <br />
              <span className="text-brand-orange">Free Estimate</span>
            </h1>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
              Step {step} of {totalSteps}
            </p>
            <div className="mt-6">{children}</div>

            {showNav && (
              <div className="mt-10 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={onPrevious}
                  disabled={step === 1}
                  className="text-sm font-medium text-brand-midnight transition-colors hover:text-brand-orange disabled:cursor-not-allowed disabled:text-neutral-400"
                >
                  &larr; Previous step
                </button>

                <div className="mx-4 hidden h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 sm:block">
                  <div
                    className="h-full rounded-full bg-brand-orange transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <button
                  type="button"
                  onClick={onNext}
                  disabled={nextDisabled}
                  className="rounded-full bg-brand-midnight px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-midnight/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {nextLabel}
                </button>
              </div>
            )}

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-200 sm:hidden">
              <div
                className="h-full rounded-full bg-brand-orange transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <p className="mt-12 text-center text-sm text-neutral-600">
          Questions? Call{" "}
          <a href={COMPANY.phoneHref} className="font-semibold text-brand-orange hover:underline">
            {COMPANY.phone}
          </a>
        </p>
      </div>
    </div>
  );
}
