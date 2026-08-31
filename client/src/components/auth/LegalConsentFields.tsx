"use client";

import Link from "next/link";
import SmsConsentDisclosure from "@/components/legal/SmsConsentDisclosure";
import { formatUsPhoneInput } from "@/lib/smsConsent";

interface LegalConsentFieldsProps {
  acceptLegal: boolean;
  onAcceptLegalChange: (checked: boolean) => void;
  smsOptIn: boolean;
  onSmsOptInChange: (checked: boolean) => void;
  phone?: string;
  onPhoneChange?: (value: string) => void;
  showPhone?: boolean;
  idPrefix?: string;
}

export default function LegalConsentFields({
  acceptLegal,
  onAcceptLegalChange,
  smsOptIn,
  onSmsOptInChange,
  phone = "",
  onPhoneChange,
  showPhone = false,
  idPrefix = "legal",
}: LegalConsentFieldsProps) {
  const legalId = `${idPrefix}-accept`;
  const smsId = `${idPrefix}-sms`;
  const phoneId = `${idPrefix}-phone`;

  return (
    <div className="space-y-3">
      <label htmlFor={legalId} className="flex gap-3 text-sm text-brand-dark">
        <input
          id={legalId}
          name="acceptLegal"
          type="checkbox"
          required
          checked={acceptLegal}
          onChange={(e) => onAcceptLegalChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
        />
        <span>
          I agree to the{" "}
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-orange hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-orange hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      {showPhone && onPhoneChange && (
        <div>
          <label
            htmlFor={phoneId}
            className="block text-sm font-medium text-brand-dark"
          >
            Mobile number
          </label>
          <input
            id={phoneId}
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => onPhoneChange(formatUsPhoneInput(e.target.value))}
            required={smsOptIn}
            placeholder="(555)555-5555"
            className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Required if you opt in to text messages.
          </p>
        </div>
      )}

      <label htmlFor={smsId} className="flex gap-3 text-sm text-brand-dark">
        <input
          id={smsId}
          name="smsOptIn"
          type="checkbox"
          checked={smsOptIn}
          onChange={(e) => onSmsOptInChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
        />
        <SmsConsentDisclosure />
      </label>
    </div>
  );
}
