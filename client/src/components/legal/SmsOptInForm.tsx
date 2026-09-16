"use client";

import { FormEvent, useState } from "react";
import PhoneInput from "@/components/ui/PhoneInput";
import SmsConsentDisclosure from "@/components/legal/SmsConsentDisclosure";
import { ApiError, submitSmsOptIn } from "@/lib/api";
import {
  isValidUsPhone,
  SMS_CONSENT_DISCLOSURE_TEXT,
  SMS_OPT_IN_REQUIRED_MESSAGE,
} from "@/lib/smsConsent";

const inputClass =
  "mt-1 block w-full rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange";

export default function SmsOptInForm() {
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!smsOptIn) {
      setError("Check the box to opt in to text messages.");
      return;
    }

    if (!isValidUsPhone(phone)) {
      setError(SMS_OPT_IN_REQUIRED_MESSAGE);
      return;
    }

    setLoading(true);
    try {
      const result = await submitSmsOptIn({ phone, smsOptIn: true });
      setSuccess(result.message);
      setSmsOptIn(false);
      setPhone("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Unable to save your opt-in. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <div>
        <label
          htmlFor="sms-program-phone"
          className="block text-sm font-medium text-brand-dark"
        >
          Mobile number
        </label>
        <PhoneInput
          id="sms-program-phone"
          name="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required={smsOptIn}
          className={inputClass}
        />
      </div>

      <label
        htmlFor="sms-program-consent"
        className="flex gap-3 text-sm text-brand-dark"
      >
        <input
          id="sms-program-consent"
          name="smsOptIn"
          type="checkbox"
          checked={smsOptIn}
          onChange={(e) => setSmsOptIn(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
        />
        <SmsConsentDisclosure />
      </label>

      <p>{SMS_CONSENT_DISCLOSURE_TEXT}</p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}

      <button
        type="submit"
        disabled={loading}
        className="min-h-11 rounded-md bg-brand-orange px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? "Submitting…" : "Opt in to text messages"}
      </button>
    </form>
  );
}
