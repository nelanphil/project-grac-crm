"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore, userNeedsLegalConsent } from "@/store/useAuthStore";
import { authLogin, ApiError } from "@/lib/api";
import PasswordInput from "@/components/ui/PasswordInput";

export default function LoginForm() {
  const router = useRouter();
  const { login, redirectAfterAuth, setRedirectAfterAuth } = useAuthStore();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { token, user } = await authLogin(identifier, password);
      login(token, user);

      if (userNeedsLegalConsent(user)) {
        router.push("/auth/legal-consent");
        return;
      }

      const destination = redirectAfterAuth ?? "/dashboard";
      setRedirectAfterAuth(null);
      router.push(destination);
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

      <div>
        <label
          htmlFor="identifier"
          className="block text-sm font-medium text-brand-dark"
        >
          Email or username
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          required
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          placeholder="you@company.com or username"
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          Most users sign in with just their username. If yours is shared,
          include your number (e.g. doc1).
        </p>
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          placeholder="Enter your password"
        />
        <div className="mt-1.5 text-right">
          <Link
            href="/auth/forgot-password"
            className="text-sm font-medium text-brand-orange hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full disabled:opacity-60"
      >
        {loading ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}
