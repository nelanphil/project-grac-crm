"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authRegister, ApiError } from "@/lib/api";
import PasswordInput from "@/components/ui/PasswordInput";
import LegalConsentFields from "@/components/auth/LegalConsentFields";
import {
  isValidUsPhone,
  SMS_OPT_IN_REQUIRED_MESSAGE,
} from "@/lib/smsConsent";

export default function SignupForm() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptLegal, setAcceptLegal] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!acceptLegal) {
      setError("You must accept the Terms of Service and Privacy Policy.");
      return;
    }

    if (smsOptIn && !isValidUsPhone(phone)) {
      setError(SMS_OPT_IN_REQUIRED_MESSAGE);
      return;
    }

    setLoading(true);

    try {
      await authRegister({
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        phone: phone.trim() || undefined,
        acceptTerms: true,
        acceptPrivacy: true,
        smsOptIn,
      });

      router.push("/auth/login");
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

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor="firstName"
            className="block text-sm font-medium text-brand-dark"
          >
            First Name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
            placeholder="Jane"
          />
        </div>
        <div>
          <label
            htmlFor="lastName"
            className="block text-sm font-medium text-brand-dark"
          >
            Last Name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
            placeholder="Doe"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-brand-dark"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-brand-dark"
        >
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          placeholder="Create a password"
        />
      </div>

      <div>
        <label
          htmlFor="confirmPassword"
          className="block text-sm font-medium text-brand-dark"
        >
          Confirm Password
        </label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          placeholder="Confirm your password"
        />
      </div>

      <LegalConsentFields
        idPrefix="signup"
        acceptLegal={acceptLegal}
        onAcceptLegalChange={setAcceptLegal}
        smsOptIn={smsOptIn}
        onSmsOptInChange={setSmsOptIn}
        showPhone
        phone={phone}
        onPhoneChange={setPhone}
      />

      <button
        type="submit"
        disabled={loading || !acceptLegal}
        className="btn-primary w-full disabled:opacity-60"
      >
        {loading ? "Creating account…" : "Create Account"}
      </button>
    </form>
  );
}
