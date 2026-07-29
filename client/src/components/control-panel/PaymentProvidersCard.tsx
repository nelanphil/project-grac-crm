"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import PasswordInput from "@/components/ui/PasswordInput";
import {
  ApiError,
  createPaymentProviderAccount,
  deletePaymentProviderAccount,
  getPaymentProviderAccounts,
  PaymentProviderAccountItem,
  PaymentProviderName,
  updatePaymentProviderAccount,
} from "@/lib/api";

type FormState = {
  provider: PaymentProviderName;
  friendlyName: string;
  environment: "sandbox" | "production";
  applicationId: string;
  locationId: string;
  publishableKey: string;
  clientId: string;
  accessToken: string;
  webhookSignatureKey: string;
  secretKey: string;
  webhookSecret: string;
  clientSecret: string;
  webhookId: string;
  isActive: boolean;
  isDefault: boolean;
};

const EMPTY_FORM: FormState = {
  provider: "square",
  friendlyName: "",
  environment: "sandbox",
  applicationId: "",
  locationId: "",
  publishableKey: "",
  clientId: "",
  accessToken: "",
  webhookSignatureKey: "",
  secretKey: "",
  webhookSecret: "",
  clientSecret: "",
  webhookId: "",
  isActive: true,
  isDefault: false,
};

const PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  square: "Square",
  stripe: "Stripe",
  paypal: "PayPal",
};

export default function PaymentProvidersCard() {
  const token = useAuthStore((s) => s.token);

  const [accounts, setAccounts] = useState<PaymentProviderAccountItem[]>([]);
  const [webhooks, setWebhooks] = useState<Record<string, string> | null>(null);
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
    getPaymentProviderAccounts(token)
      .then(({ accounts: list, webhooks: hooks }) => {
        setAccounts(list);
        setWebhooks(hooks);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load payment providers.",
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

  function openEdit(account: PaymentProviderAccountItem) {
    setEditingId(account._id);
    setForm({
      provider: account.provider,
      friendlyName: account.friendlyName,
      environment: account.environment,
      applicationId: account.applicationId ?? "",
      locationId: account.locationId ?? "",
      publishableKey: account.publishableKey ?? "",
      clientId: account.clientId ?? "",
      accessToken: "",
      webhookSignatureKey: "",
      secretKey: "",
      webhookSecret: "",
      clientSecret: "",
      webhookId: "",
      isActive: account.isActive,
      isDefault: account.isDefault,
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

  function field(key: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setSaveError(null);

    const payload = {
      provider: form.provider,
      friendlyName: form.friendlyName.trim(),
      environment: form.environment,
      isActive: form.isActive,
      isDefault: form.isDefault,
      applicationId: form.applicationId.trim() || undefined,
      locationId: form.locationId.trim() || undefined,
      publishableKey: form.publishableKey.trim() || undefined,
      clientId: form.clientId.trim() || undefined,
      accessToken: form.accessToken.trim() || undefined,
      webhookSignatureKey: form.webhookSignatureKey.trim() || undefined,
      secretKey: form.secretKey.trim() || undefined,
      webhookSecret: form.webhookSecret.trim() || undefined,
      clientSecret: form.clientSecret.trim() || undefined,
      webhookId: form.webhookId.trim() || undefined,
    };

    try {
      if (editingId) {
        const { account } = await updatePaymentProviderAccount(
          token,
          editingId,
          payload,
        );
        setAccounts((prev) =>
          prev
            .map((a) => {
              if (a._id === editingId) return account;
              if (account.isDefault && a.isDefault) {
                return { ...a, isDefault: false };
              }
              return a;
            })
            .sort((a, b) =>
              a.provider === b.provider
                ? a.friendlyName.localeCompare(b.friendlyName)
                : a.provider.localeCompare(b.provider),
            ),
        );
      } else {
        const { account } = await createPaymentProviderAccount(token, payload);
        setAccounts((prev) =>
          [...prev.map((a) => (account.isDefault ? { ...a, isDefault: false } : a)), account].sort(
            (a, b) =>
              a.provider === b.provider
                ? a.friendlyName.localeCompare(b.friendlyName)
                : a.provider.localeCompare(b.provider),
          ),
        );
      }
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save payment provider account.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (
      !window.confirm(
        "Delete this payment provider account? This cannot be undone.",
      )
    ) {
      return;
    }

    setDeletingId(id);
    try {
      await deletePaymentProviderAccount(token, id);
      setAccounts((prev) => prev.filter((a) => a._id !== id));
      if (editingId === id) closeForm();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete payment provider account.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading payment providers…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-100">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">
            Payment providers
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Store Square, Stripe, and PayPal credentials for invoice checkout.
            Secrets are encrypted at rest. Set one account as the default
            checkout provider.
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

      {webhooks ? (
        <div className="mx-6 mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600 space-y-2">
          <p className="font-semibold text-brand-dark">Webhook URLs</p>
          <div>
            <span className="font-medium">Square:</span>{" "}
            <code className="break-all">{webhooks.square}</code>
          </div>
          <div>
            <span className="font-medium">Stripe:</span>{" "}
            <code className="break-all">{webhooks.stripe}</code>
          </div>
          <div>
            <span className="font-medium">PayPal:</span>{" "}
            <code className="break-all">{webhooks.paypal}</code>
          </div>
          <p className="text-neutral-500">
            Configure these URLs in each provider&apos;s developer dashboard.
            Checkout redirects use your app URL{" "}
            <code>/checkout/complete</code>.
          </p>
        </div>
      ) : null}

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="border-b border-neutral-100 px-6 py-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {editingId
                ? "Edit payment provider"
                : "Add payment provider"}
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
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Provider
              </span>
              <select
                required
                disabled={Boolean(editingId)}
                value={form.provider}
                onChange={(e) =>
                  field("provider", e.target.value as PaymentProviderName)
                }
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark disabled:bg-neutral-50"
              >
                <option value="square">Square</option>
                <option value="stripe">Stripe</option>
                <option value="paypal">PayPal</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Environment
              </span>
              <select
                required
                value={form.environment}
                onChange={(e) =>
                  field(
                    "environment",
                    e.target.value as "sandbox" | "production",
                  )
                }
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Account name
              </span>
              <input
                required
                value={form.friendlyName}
                onChange={(e) => field("friendlyName", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="Main Square account"
              />
            </label>

            {form.provider === "square" && (
              <>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Application ID
                  </span>
                  <input
                    required={!editingId}
                    value={form.applicationId}
                    onChange={(e) => field("applicationId", e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder="sq0idp-…"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Location ID
                  </span>
                  <input
                    required={!editingId}
                    value={form.locationId}
                    onChange={(e) => field("locationId", e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder="L…"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Access token
                    {editingId ? " (leave blank to keep)" : ""}
                  </span>
                  <PasswordInput
                    required={!editingId}
                    value={form.accessToken}
                    onChange={(e) => field("accessToken", e.target.value)}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder={editingId ? "••••••••" : "Access token"}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Webhook signature key
                    {editingId ? " (leave blank to keep)" : " (optional)"}
                  </span>
                  <PasswordInput
                    value={form.webhookSignatureKey}
                    onChange={(e) =>
                      field("webhookSignatureKey", e.target.value)
                    }
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder={editingId ? "••••••••" : "Signature key"}
                  />
                </label>
              </>
            )}

            {form.provider === "stripe" && (
              <>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-neutral-600">
                    Publishable key
                  </span>
                  <input
                    required={!editingId}
                    value={form.publishableKey}
                    onChange={(e) => field("publishableKey", e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder="pk_…"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Secret key
                    {editingId ? " (leave blank to keep)" : ""}
                  </span>
                  <PasswordInput
                    required={!editingId}
                    value={form.secretKey}
                    onChange={(e) => field("secretKey", e.target.value)}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder={editingId ? "••••••••" : "sk_…"}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Webhook secret
                    {editingId ? " (leave blank to keep)" : " (optional)"}
                  </span>
                  <PasswordInput
                    value={form.webhookSecret}
                    onChange={(e) => field("webhookSecret", e.target.value)}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder={editingId ? "••••••••" : "whsec_…"}
                  />
                </label>
              </>
            )}

            {form.provider === "paypal" && (
              <>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-neutral-600">
                    Client ID
                  </span>
                  <input
                    required={!editingId}
                    value={form.clientId}
                    onChange={(e) => field("clientId", e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Client secret
                    {editingId ? " (leave blank to keep)" : ""}
                  </span>
                  <PasswordInput
                    required={!editingId}
                    value={form.clientSecret}
                    onChange={(e) => field("clientSecret", e.target.value)}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder={editingId ? "••••••••" : "Client secret"}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">
                    Webhook ID
                    {editingId ? " (leave blank to keep)" : " (optional)"}
                  </span>
                  <PasswordInput
                    value={form.webhookId}
                    onChange={(e) => field("webhookId", e.target.value)}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                    placeholder={editingId ? "••••••••" : "Webhook ID"}
                  />
                </label>
              </>
            )}

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => field("isActive", e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
              />
              <span className="text-sm text-neutral-700">Active</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => field("isDefault", e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
              />
              <span className="text-sm text-neutral-700">
                Default checkout provider
              </span>
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
          No payment providers configured yet. Add Square (or Stripe / PayPal)
          credentials to enable invoice checkout.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-100 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Environment
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
                    {PROVIDER_LABELS[account.provider]}
                  </td>
                  <td className="px-6 py-4 text-neutral-700">
                    {account.friendlyName}
                    <div className="mt-0.5 text-xs text-neutral-400">
                      {account.provider === "square" &&
                        (account.hasAccessToken
                          ? "Access token set"
                          : "Missing access token")}
                      {account.provider === "stripe" &&
                        (account.hasSecretKey
                          ? "Secret key set"
                          : "Missing secret key")}
                      {account.provider === "paypal" &&
                        (account.hasClientSecret
                          ? "Client secret set"
                          : "Missing client secret")}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-neutral-600 capitalize whitespace-nowrap">
                    {account.environment}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      <span
                        className={
                          account.isActive
                            ? "inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                            : "inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500"
                        }
                      >
                        {account.isActive ? "Active" : "Inactive"}
                      </span>
                      {account.isDefault ? (
                        <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Default
                        </span>
                      ) : null}
                    </div>
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
