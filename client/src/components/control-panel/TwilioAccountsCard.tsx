"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  createTwilioAccount,
  deleteTwilioAccount,
  getTwilioAccounts,
  TwilioAccountItem,
  updateTwilioAccount,
} from "@/lib/api";

type FormState = {
  friendlyName: string;
  accountSid: string;
  authToken: string;
  testAuthToken: string;
  phoneNumbers: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  friendlyName: "",
  accountSid: "",
  authToken: "",
  testAuthToken: "",
  phoneNumbers: "",
  isActive: true,
};

function maskSid(sid: string): string {
  if (sid.length <= 8) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

function parsePhoneNumbers(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function TwilioAccountsCard() {
  const token = useAuthStore((s) => s.token);

  const [accounts, setAccounts] = useState<TwilioAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);
    getTwilioAccounts(token)
      .then(({ accounts: list }) => setAccounts(list))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load Twilio accounts.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(account: TwilioAccountItem) {
    setEditingId(account._id);
    setForm({
      friendlyName: account.friendlyName,
      accountSid: account.accountSid,
      authToken: "",
      testAuthToken: "",
      phoneNumbers: account.phoneNumbers.join(", "),
      isActive: account.isActive,
    });
    setSaveError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setSaveError(null);

    const payload = {
      friendlyName: form.friendlyName.trim(),
      accountSid: form.accountSid.trim(),
      authToken: form.authToken.trim() || undefined,
      testAuthToken: form.testAuthToken.trim() || undefined,
      phoneNumbers: parsePhoneNumbers(form.phoneNumbers),
      isActive: form.isActive,
    };

    try {
      if (editingId) {
        const { account } = await updateTwilioAccount(
          token,
          editingId,
          payload,
        );
        setAccounts((prev) =>
          prev.map((a) => (a._id === editingId ? account : a)),
        );
      } else {
        if (!payload.authToken) {
          setSaveError("Auth token is required for new accounts.");
          setSaving(false);
          return;
        }
        const { account } = await createTwilioAccount(token, {
          ...payload,
          authToken: payload.authToken,
        });
        setAccounts((prev) =>
          [...prev, account].sort((a, b) =>
            a.friendlyName.localeCompare(b.friendlyName),
          ),
        );
      }
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save Twilio account.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (!window.confirm("Delete this Twilio account? This cannot be undone."))
      return;

    setDeletingId(id);
    try {
      await deleteTwilioAccount(token, id);
      setAccounts((prev) => prev.filter((a) => a._id !== id));
      if (editingId === id) closeForm();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete Twilio account.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function field(key: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading Twilio accounts…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-100">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">Twilio</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Configure Twilio accounts for future SMS, MMS, and phone calls.
            Accounts are keyed by Account SID.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
          >
            <Plus className="h-4 w-4" />
            Add account
          </button>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="border-b border-neutral-100 px-6 py-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {editingId ? "Edit Twilio account" : "Add Twilio account"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {saveError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Account name
              </span>
              <input
                required
                value={form.friendlyName}
                onChange={(e) => field("friendlyName", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="Main production account"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Account SID
              </span>
              <input
                required
                value={form.accountSid}
                onChange={(e) => field("accountSid", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Auth token{editingId ? " (leave blank to keep current)" : ""}
              </span>
              <input
                type="password"
                required={!editingId}
                value={form.authToken}
                onChange={(e) => field("authToken", e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder={editingId ? "••••••••" : "Live auth token"}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Test auth token
                {editingId ? " (leave blank to keep)" : " (optional)"}
              </span>
              <input
                type="password"
                value={form.testAuthToken}
                onChange={(e) => field("testAuthToken", e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder={editingId ? "••••••••" : "Test auth token"}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Twilio phone numbers (comma or newline separated)
              </span>
              <textarea
                value={form.phoneNumbers}
                onChange={(e) => field("phoneNumbers", e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="+15551234567, +15559876543"
              />
            </label>

            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => field("isActive", e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
              />
              <span className="text-sm text-neutral-700">Active</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
            >
              {saving
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "Create account"}
            </button>
          </div>
        </form>
      )}

      {accounts.length === 0 ? (
        <div className="px-6 py-8 text-sm text-neutral-500">
          No Twilio accounts configured yet. Add one to store credentials for
          messaging and calls.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-100 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Account SID
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Phones
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Status
                </th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {accounts.map((account) => (
                <tr key={account._id}>
                  <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                    {account.friendlyName}
                    <div className="mt-0.5 text-xs font-normal text-neutral-400">
                      {account.hasAuthToken
                        ? "Auth token set"
                        : "Missing auth token"}
                      {account.hasTestAuthToken ? " · Test token set" : ""}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-neutral-600 whitespace-nowrap">
                    {maskSid(account.accountSid)}
                  </td>
                  <td className="px-6 py-4 text-neutral-600">
                    {account.phoneNumbers.length > 0
                      ? account.phoneNumbers.join(", ")
                      : "—"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={
                        account.isActive
                          ? "inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                          : "inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500"
                      }
                    >
                      {account.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEdit(account)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
                      aria-label={`Edit ${account.friendlyName}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(account._id)}
                      disabled={deletingId === account._id}
                      className="ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label={`Delete ${account.friendlyName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
