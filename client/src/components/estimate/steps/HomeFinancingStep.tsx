import { COMPANY } from "@/lib/constants";
import type { EstimateFormData } from "@/lib/estimate-types";

interface HomeFinancingStepProps {
  data: EstimateFormData;
  errors: Partial<Record<keyof EstimateFormData, string>>;
  onChange: (field: keyof EstimateFormData, value: string | boolean | null) => void;
  submitError?: string;
  isSubmitting?: boolean;
}

function RadioOption({
  name,
  value,
  checked,
  label,
  onChange,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-4 transition-colors ${
        checked
          ? "border-brand-orange bg-brand-orange/5"
          : "border-neutral-300 hover:border-neutral-400"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="h-4 w-4 text-brand-orange focus:ring-brand-orange"
      />
      <span className="font-medium text-brand-dark">{label}</span>
    </label>
  );
}

export default function HomeFinancingStep({
  data,
  errors,
  onChange,
  submitError,
  isSubmitting,
}: HomeFinancingStepProps) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-brand-midnight">
        Tell us about your home
      </h2>

      <div className="mt-8 space-y-8">
        <fieldset>
          <legend className="text-base font-semibold text-brand-dark">
            What type of home do you have? *
          </legend>
          <div className="mt-4 space-y-3">
            <RadioOption
              name="homeType"
              value="single_family"
              checked={data.homeType === "single_family"}
              label="Single Family Home"
              onChange={(v) => onChange("homeType", v)}
            />
            <RadioOption
              name="homeType"
              value="other"
              checked={data.homeType === "other"}
              label="Other"
              onChange={(v) => onChange("homeType", v)}
            />
          </div>
          {errors.homeType && (
            <p className="mt-2 text-sm text-red-600">{errors.homeType}</p>
          )}
        </fieldset>

        <fieldset>
          <legend className="text-base font-semibold text-brand-dark">
            Are you interested in affordable financing options? *
          </legend>
          <div className="mt-4 space-y-3">
            <RadioOption
              name="financing"
              value="yes"
              checked={data.interestedInFinancing === true}
              label="Yes"
              onChange={() => onChange("interestedInFinancing", true)}
            />
            <RadioOption
              name="financing"
              value="no"
              checked={data.interestedInFinancing === false}
              label="Not at this time"
              onChange={() => onChange("interestedInFinancing", false)}
            />
          </div>
          {errors.interestedInFinancing && (
            <p className="mt-2 text-sm text-red-600">{errors.interestedInFinancing}</p>
          )}
        </fieldset>

        <p className="text-xs leading-relaxed text-neutral-600">
          By clicking Submit, you consent to {COMPANY.name} sharing your contact
          information for the purpose of providing a generator estimate. You also
          agree to receive phone calls, emails, and automated messages from us
          regarding your request. See our privacy policy for details.
        </p>

        {submitError && (
          <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </p>
        )}

        {isSubmitting && (
          <p className="text-sm text-neutral-600">Submitting your request...</p>
        )}
      </div>
    </div>
  );
}
