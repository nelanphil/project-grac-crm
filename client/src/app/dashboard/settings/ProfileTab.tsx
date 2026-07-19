"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  updateProfile,
  checkUsernameAvailability,
  UsernameCheckResult,
  ApiError,
} from "@/lib/api";
import UsernameDisplay from "@/components/ui/UsernameDisplay";

export default function ProfileTab() {
  const { user, token, login } = useAuthStore();

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [usernameNumber, setUsernameNumber] = useState<number | null>(
    user?.usernameNumber ?? null,
  );
  const [preview, setPreview] = useState<UsernameCheckResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live username availability / dupe preview (debounced)
  useEffect(() => {
    if (!token) return;

    const trimmed = username.trim();
    let cancelled = false;
    const handle = window.setTimeout(() => {
      if (!trimmed) {
        setPreview({
          valid: true,
          username: null,
          usernameNumber: null,
          isShared: false,
          signInAs: null,
          message: "Leave blank to clear your username.",
        });
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      checkUsernameAvailability(token, trimmed)
        .then((result) => {
          if (!cancelled) setPreview(result);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [username, token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      const { user: updated } = await updateProfile(token!, {
        first_name: firstName,
        last_name: lastName,
        email,
        username: username.trim() === "" ? null : username.trim().toLowerCase(),
      });
      login(token!, updated);
      setUsername(updated.username ?? "");
      setUsernameNumber(updated.usernameNumber ?? null);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const displayUsername = preview?.username ?? (username.trim() || null);
  const displayNumber =
    preview != null ? preview.usernameNumber : usernameNumber;
  const showPreview = Boolean(username.trim()) || preview != null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-brand-dark mb-6">Profile</h2>

      {success && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Profile updated successfully.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="firstName"
              className="block text-sm font-medium text-brand-dark"
            >
              First Name
            </label>
            <input
              id="firstName"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
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
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
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
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-neutral-200 px-4 py-2.5 text-brand-dark outline-none transition-colors focus:border-brand-orange focus:ring-1 focus:ring-brand-orange"
          />
        </div>

        <div>
          <label
            htmlFor="username"
            className="block text-sm font-medium text-brand-dark"
          >
            Username{" "}
            <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setSuccess(false);
            }}
            title="3–30 characters, start with a letter, letters/numbers/underscores only"
            className={`mt-1 block w-full rounded-md border px-4 py-2.5 text-brand-dark outline-none transition-colors focus:ring-1 ${
              preview && !preview.valid
                ? "border-red-300 focus:border-red-400 focus:ring-red-400"
                : "border-neutral-200 focus:border-brand-orange focus:ring-brand-orange"
            }`}
            placeholder="e.g. doc"
          />

          {previewLoading && username.trim() && (
            <p className="mt-2 text-xs text-neutral-500">Checking username…</p>
          )}

          {!previewLoading && showPreview && preview && (
            <div className="mt-2 space-y-1">
              {preview.valid && preview.username && (
                <p className="text-sm text-neutral-600">
                  {preview.isShared
                    ? "If you save, your sign-in username: "
                    : "Your sign-in username: "}
                  <UsernameDisplay
                    username={displayUsername}
                    usernameNumber={displayNumber}
                    className="font-medium text-brand-dark"
                  />
                  {displayNumber != null ? (
                    <span className="ml-1 text-xs text-neutral-500">
                      (sign in as {preview.signInAs} — this name is shared)
                    </span>
                  ) : (
                    <span className="ml-1 text-xs text-neutral-500">
                      (sign in as {preview.signInAs})
                    </span>
                  )}
                </p>
              )}
              {preview.message && (
                <p
                  className={`text-xs ${
                    preview.valid
                      ? preview.isShared
                        ? "text-amber-700"
                        : "text-neutral-500"
                      : "text-red-600"
                  }`}
                >
                  {preview.message}
                </p>
              )}
            </div>
          )}

          <p className="mt-1.5 text-xs text-neutral-500">
            Availability is checked as you type. The first person to claim a
            username signs in with just that name; later accounts get a number.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={
              loading ||
              (Boolean(username.trim()) && preview != null && !preview.valid)
            }
            className="btn-primary px-6 py-2.5 text-sm disabled:opacity-60"
          >
            {loading ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
