"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { authAcceptLegalConsent, ApiError } from "@/lib/api";
import LegalConsentFields from "@/components/auth/LegalConsentFields";

export default function LegalConsentForm() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const redirectAfterAuth = useAuthStore((s) => s.redirectAfterAuth);
  const setRedirectAfterAuth = useAuthStore((s) => s.setRedirectAfterAuth);

  const [acceptLegal, setAcceptLegal] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!acceptLegal) {
      setError("You must accept the Terms of Service and Privacy Policy.");
      return;
    }

    if (!token) {
      setError("Your session expired. Please sign in again.");
      router.replace("/auth/login");
      return;
    }

    setLoading(true);

    try {
      const { user } = await authAcceptLegalConsent(token, {
        acceptTerms: true,
        acceptPrivacy: true,
        smsOptIn,
      });
      login(token, user);

      const destination = redirectAfterAuth ?? "/dashboard";
      setRedirectAfterAuth(null);
      router.replace(destination);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="text-sm text-neutral-600">
        Before continuing, please review and accept our legal terms. You may also
        opt in to text message alerts.
      </p>

      <LegalConsentFields
        idPrefix="consent"
        acceptLegal={acceptLegal}
        onAcceptLegalChange={setAcceptLegal}
        smsOptIn={smsOptIn}
        onSmsOptInChange={setSmsOptIn}
      />

      <button
        type="submit"
        disabled={loading || !acceptLegal}
        className="btn-primary w-full disabled:opacity-60"
      >
        {loading ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
