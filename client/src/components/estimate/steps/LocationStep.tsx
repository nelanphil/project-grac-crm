import { US_STATES } from "@/lib/constants";
import type { EstimateFormData } from "@/lib/estimate-types";

interface LocationStepProps {
  data: EstimateFormData;
  errors: Partial<Record<keyof EstimateFormData, string>>;
  onChange: (field: keyof EstimateFormData, value: string | boolean) => void;
}

const labelClass = "block text-sm font-medium text-neutral-600";
const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-4 py-3 text-brand-dark placeholder:text-neutral-400 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange";

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function LocationStep({ data, errors, onChange }: LocationStepProps) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-brand-midnight">
        Where would your generator be installed?
      </h2>

      <div className="mt-8 space-y-5">
        <Field id="country" label="Country">
          <select
            id="country"
            value={data.country}
            onChange={(e) => onChange("country", e.target.value)}
            className={inputClass}
          >
            <option value="United States">United States</option>
          </select>
        </Field>

        <Field id="addressLine1" label="Address Line 1" error={errors.addressLine1}>
          <input
            id="addressLine1"
            type="text"
            placeholder="Street address"
            value={data.addressLine1}
            onChange={(e) => onChange("addressLine1", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field id="addressLine2" label="Address Line 2">
          <input
            id="addressLine2"
            type="text"
            placeholder="Apt, suite, unit (optional)"
            value={data.addressLine2}
            onChange={(e) => onChange("addressLine2", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field id="city" label="City" error={errors.city}>
          <input
            id="city"
            type="text"
            placeholder="City"
            value={data.city}
            onChange={(e) => onChange("city", e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="state" label="State/Province" error={errors.state}>
            <select
              id="state"
              value={data.state}
              onChange={(e) => onChange("state", e.target.value)}
              className={inputClass}
            >
              <option value="">-- Select an option --</option>
              {US_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </Field>

          <Field id="zipCode" label="Zip/Postal Code" error={errors.zipCode}>
            <input
              id="zipCode"
              type="text"
              placeholder="Zip/Postal Code"
              value={data.zipCode}
              onChange={(e) => onChange("zipCode", e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field id="phone" label="Phone Number" error={errors.phone}>
          <input
            id="phone"
            type="tel"
            placeholder="Phone Number"
            value={data.phone}
            onChange={(e) => onChange("phone", e.target.value)}
            className={inputClass}
          />
        </Field>

        <label className="flex items-start gap-3 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={data.smsConsent}
            onChange={(e) => onChange("smsConsent", e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
          />
          <span>
            I agree to receive automated text messages at the phone number provided.
            Message and data rates may apply. Reply STOP to opt out.
          </span>
        </label>
      </div>
    </div>
  );
}
