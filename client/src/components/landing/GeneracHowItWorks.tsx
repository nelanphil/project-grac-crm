"use client";

import { useState } from "react";
import { GENERAC_HOME_STANDBY } from "@/lib/constants";
import { HOW_IT_WORKS_ILLUSTRATIONS } from "./GeneracHowItWorksIllustrations";

export default function GeneracHowItWorks() {
  const [activeStep, setActiveStep] = useState(0);
  const steps = GENERAC_HOME_STANDBY.howItWorks;
  const current = steps[activeStep];
  const Illustration = HOW_IT_WORKS_ILLUSTRATIONS[activeStep];

  return (
    <div className="mt-16">
      <h3 className="text-center text-2xl font-bold text-brand-dark">
        How Home Standby Generators Work
      </h3>
      <p className="mx-auto mt-4 max-w-3xl text-center text-neutral-600">
        {GENERAC_HOME_STANDBY.howItWorksIntro}
      </p>

      <div className="mt-10 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3">
          {steps.map((step, index) => (
            <button
              key={step.step}
              type="button"
              onClick={() => setActiveStep(index)}
              aria-current={activeStep === index ? "true" : undefined}
              aria-controls={`how-it-works-panel-${index}`}
              id={`how-it-works-tab-${index}`}
              className={`flex items-start gap-3 border-b border-neutral-200 px-5 py-5 text-left transition-colors sm:border-b-0 sm:border-r sm:last:border-r-0 ${
                activeStep === index
                  ? "bg-neutral-100"
                  : "bg-white hover:bg-neutral-50"
              }`}
            >
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  activeStep === index
                    ? "border-brand-orange bg-brand-orange text-white"
                    : "border-brand-orange bg-white text-brand-orange"
                }`}
              >
                {step.label}
              </span>
              <span
                className={`text-sm font-semibold leading-snug ${
                  activeStep === index ? "text-brand-dark" : "text-neutral-600"
                }`}
              >
                {step.title}
              </span>
            </button>
          ))}
        </div>

        <div
          id={`how-it-works-panel-${activeStep}`}
          role="tabpanel"
          aria-labelledby={`how-it-works-tab-${activeStep}`}
          className="border-t border-neutral-200 bg-neutral-100 px-6 py-10 sm:px-10 sm:py-12"
        >
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 md:flex-row md:items-center md:gap-12">
            <div className="w-full flex-1 md:max-w-[55%]">
              <Illustration />
            </div>
            <p className="flex-1 text-base leading-relaxed text-brand-dark md:text-lg">
              {current.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
