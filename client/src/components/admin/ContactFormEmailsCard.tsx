"use client";

import { FormEvent, useEffect, useState } from "react";
import { Mail, Plus, Trash2 } from "lucide-react";
import {
  ApiError,
  getContactFormSettings,
  saveContactFormSettings,
} from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ContactFormEmailsCard({
  token,
}: {
  token: string | null;
}) {
  const [emails, setEmails] = useState<string[]>([]);
  const [savedEmails, setSavedEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const dirty =
    JSON.stringify(emails) !== JSON.stringify(savedEmails);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { emails: list } = await getContactFormSettings(token!);
        if (!cancelled) {
          setEmails(list);
          setSavedEmails(list);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load contact form emails.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function addEmail() {
    const value = draft.trim().toLowerCase();
    setDraftError(null);
    setSaveSuccess(false);

    if (!value) {
      setDraftError("Enter an email address.");
      return;
    }
    if (!EMAIL_PATTERN.test(value)) {
      setDraftError("Enter a valid email address.");
      return;
    }
    if (emails.includes(value)) {
      setDraftError("That email is already on the list.");
      return;
    }
    if (emails.length >= 20) {
      setDraftError("A maximum of 20 recipient emails is allowed.");
      return;
    }

    setEmails((prev) => [...prev, value]);
    setDraft("");
  }

  function removeEmail(address: string) {
    setSaveSuccess(false);
    setEmails((prev) => prev.filter((email) => email !== address));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const { emails: list } = await saveContactFormSettings(token, emails);
      setEmails(list);
      setSavedEmails(list);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save contact form emails.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500 shadow-sm">
        Loading contact form emails…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-orange-100 p-2 text-brand-orange">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-dark">
              Contact Form Emails
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Messages from the public contact form are sent to this list.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-4 px-6 py-5">
        {saveError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Contact form emails saved.
          </div>
        )}

        <div>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Add recipient email
            </span>
            <div className="mt-1 flex gap-2">
              <input
                type="email"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEmail();
                  }
                }}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="name@example.com"
              />
              <button
                type="button"
                onClick={addEmail}
                className="inline-flex items-center gap-1 rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
          </label>
          {draftError && (
            <p className="mt-1 text-xs text-red-600">{draftError}</p>
          )}
        </div>

        {emails.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No recipient emails yet. The public contact form cannot send until
            at least one address is saved.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {emails.map((email) => (
              <li
                key={email}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="truncate text-sm text-brand-dark">
                  {email}
                </span>
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove ${email}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
