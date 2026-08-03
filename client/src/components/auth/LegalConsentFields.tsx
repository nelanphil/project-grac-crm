"use client";

import Link from "next/link";

interface LegalConsentFieldsProps {
  acceptLegal: boolean;
  onAcceptLegalChange: (checked: boolean) => void;
  smsOptIn: boolean;
  onSmsOptInChange: (checked: boolean) => void;
  idPrefix?: string;
}

export default function LegalConsentFields({
  acceptLegal,
  onAcceptLegalChange,
  smsOptIn,
  onSmsOptInChange,
  idPrefix = "legal",
}: LegalConsentFieldsProps) {
  const legalId = `${idPrefix}-accept`;
  const smsId = `${idPrefix}-sms`;

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
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-orange hover:underline"
          >
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      <label htmlFor={smsId} className="flex gap-3 text-sm text-brand-dark">
        <input
          id={smsId}
          name="smsOptIn"
          type="checkbox"
          checked={smsOptIn}
          onChange={(e) => onSmsOptInChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
        />
        <span>
          I agree to receive automated text messages at the phone number
          associated with my account. Message and data rates may apply. Reply
          STOP to opt out. This is optional and not required to create an
          account.
        </span>
      </label>
    </div>
  );
}
