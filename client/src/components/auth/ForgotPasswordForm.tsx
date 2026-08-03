"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { authForgotPassword, ApiError } from "@/lib/api";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setDevResetUrl(null);
    setMailError(null);
    setLoading(true);

    try {
      const result = await authForgotPassword(email);
      setSuccess(result.message);
      if (result.devResetUrl) {
        setDevResetUrl(result.devResetUrl);
      }
      if (result.mailError) {
        setMailError(result.mailError);
      }
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
      {success && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}
      {devResetUrl && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            {mailError
              ? "Password reset email could not be sent."
              : "Email delivery is not configured in this environment."}
          </p>
          {mailError && (
            <p className="mt-1 font-mono text-xs break-all text-amber-800">
              {mailError}
            </p>
          )}
          <p className="mt-2">
            Use this one-time reset link (also logged on the server):
          </p>
          <Link
            href={devResetUrl}
            className="mt-2 block break-all font-medium text-brand-orange hover:underline"
          >
            {devResetUrl}
          </Link>
        </div>
      )}

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

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full disabled:opacity-60"
      >
        {loading ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
