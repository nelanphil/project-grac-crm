import type { EstimateFormData } from "@/lib/estimate-types";

interface ContactStepProps {
  data: EstimateFormData;
  errors: Partial<Record<keyof EstimateFormData, string>>;
  onChange: (field: keyof EstimateFormData, value: string) => void;
}

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 px-4 py-3 text-brand-dark placeholder:text-neutral-400 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange";

export default function ContactStep({ data, errors, onChange }: ContactStepProps) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-brand-midnight">
        What&apos;s your contact information?
      </h2>

      <div className="mt-8 space-y-5">
        <div>
          <label htmlFor="firstName" className="sr-only">
            First Name
          </label>
          <input
            id="firstName"
            type="text"
            placeholder="First Name"
            value={data.firstName}
            onChange={(e) => onChange("firstName", e.target.value)}
            className={inputClass}
          />
          {errors.firstName && (
            <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>
          )}
        </div>

        <div>
          <label htmlFor="lastName" className="sr-only">
            Last Name
          </label>
          <input
            id="lastName"
            type="text"
            placeholder="Last Name"
            value={data.lastName}
            onChange={(e) => onChange("lastName", e.target.value)}
            className={inputClass}
          />
          {errors.lastName && (
            <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="sr-only">
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="Email"
            value={data.email}
            onChange={(e) => onChange("email", e.target.value)}
            className={inputClass}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600">{errors.email}</p>
          )}
        </div>
      </div>
    </div>
  );
}
