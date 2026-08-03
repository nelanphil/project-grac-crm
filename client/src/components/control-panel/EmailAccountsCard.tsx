"use client";

import { FormEvent, useEffect, useState } from "react";
import { Mail, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import PasswordInput from "@/components/ui/PasswordInput";
import {
  ApiError,
  createEmailAccount,
  deleteEmailAccount,
  EmailAccountItem,
  EmailAccountRole,
  getEmailAccounts,
  testEmailAccount,
  updateEmailAccount,
} from "@/lib/api";

type FormState = {
  friendlyName: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  isActive: boolean;
  roles: EmailAccountRole[];
};

const EMPTY_FORM: FormState = {
  friendlyName: "",
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  fromName: "",
  fromEmail: "",
  isActive: true,
  // Default so forgot-password / signup mail works after first save.
  roles: ["general_notifications"],
};

const ROLE_OPTIONS: { value: EmailAccountRole; label: string; hint: string }[] =
  [
    {
      value: "general_notifications",
      label: "General notifications",
      hint: "Forgot password, signup confirmation",
    },
    {
      value: "billing_notifications",
      label: "Billing notifications",
      hint: "Invoices and payment-related email (future)",
    },
  ];

const ROLE_BADGE_LABELS: Record<EmailAccountRole, string> = {
  general_notifications: "General",
  billing_notifications: "Billing",
};

export default function EmailAccountsCard() {
  const token = useAuthStore((s) => s.token);

  const [accounts, setAccounts] = useState<EmailAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] =
    useState<EmailAccountItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<{
    id: string;
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getEmailAccounts(token)
      .then(({ accounts: list }) => setAccounts(list))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load email accounts.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  function openCreate() {
    setEditingId(null);
    setEditingAccount(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(account: EmailAccountItem) {
    setEditingId(account._id);
    setEditingAccount(account);
    setForm({
      friendlyName: account.friendlyName,
      host: account.host,
      port: String(account.port),
      secure: account.secure,
      username: account.username,
      password: "",
      fromName: account.fromName,
      fromEmail: account.fromEmail,
      isActive: account.isActive,
      roles: [...account.roles],
    });
    setSaveError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setEditingAccount(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
  }

  function toggleRole(role: EmailAccountRole) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }

  function applyRoleExclusivityLocally(
    saved: EmailAccountItem,
    prev: EmailAccountItem[],
  ): EmailAccountItem[] {
    const claimed = new Set(saved.roles);
    return prev
      .map((a) => {
        if (a._id === saved._id) return saved;
        if (claimed.size === 0) return a;
        const roles = a.roles.filter((r) => !claimed.has(r));
        return roles.length === a.roles.length ? a : { ...a, roles };
      })
      .sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setSaveError(null);

    const port = parseInt(form.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setSaveError("Port must be a number between 1 and 65535.");
      setSaving(false);
      return;
    }

    if (form.roles.length === 0) {
      const ok = window.confirm(
        "No notification roles are selected. Forgot password and signup emails will not use this account until you assign General notifications. Save anyway?",
      );
      if (!ok) {
        setSaving(false);
        return;
      }
    }

    const payload = {
      friendlyName: form.friendlyName.trim(),
      host: form.host.trim(),
      port,
      secure: form.secure,
      username: form.username.trim(),
      password: form.password.trim() || undefined,
      fromName: form.fromName.trim(),
      fromEmail: form.fromEmail.trim(),
      isActive: form.isActive,
      roles: form.roles,
    };

    try {
      if (editingId) {
        const { account } = await updateEmailAccount(
          token,
          editingId,
          payload,
        );
        setAccounts((prev) => applyRoleExclusivityLocally(account, prev));
      } else {
        if (!payload.password) {
          setSaveError("SMTP password is required for new accounts.");
          setSaving(false);
          return;
        }
        const { account } = await createEmailAccount(token, {
          ...payload,
          password: payload.password,
        });
        setAccounts((prev) =>
          applyRoleExclusivityLocally(account, [...prev, account]),
        );
      }
      closeForm();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save email account.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    if (!window.confirm("Delete this email account? This cannot be undone."))
      return;

    setDeletingId(id);
    try {
      await deleteEmailAccount(token, id);
      setAccounts((prev) => prev.filter((a) => a._id !== id));
      if (editingId === id) closeForm();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to delete email account.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSendTest(account: EmailAccountItem) {
    if (!token) return;
    const defaultTo = account.fromEmail || "";
    const to = window.prompt(
      `Send a test email via "${account.friendlyName}".\nEnter recipient address:`,
      defaultTo,
    );
    if (!to || !to.trim()) return;

    setTestingId(account._id);
    setTestFeedback(null);
    try {
      const { message, result } = await testEmailAccount(
        token,
        account._id,
        to.trim(),
      );
      setTestFeedback({
        id: account._id,
        ok: true,
        text: `${message} messageId=${result.messageId ?? "n/a"}; response=${result.response ?? "n/a"}`,
      });
    } catch (err) {
      setTestFeedback({
        id: account._id,
        ok: false,
        text:
          err instanceof ApiError
            ? err.message
            : "Failed to send test email.",
      });
    } finally {
      setTestingId(null);
    }
  }

  function field(key: keyof FormState, value: string | boolean) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Port 465 is implicit TLS — keep the secure checkbox in sync.
      if (key === "port" && typeof value === "string") {
        const port = parseInt(value, 10);
        if (port === 465) next.secure = true;
        if (port === 587) next.secure = false;
      }
      return next;
    });
  }

  const hasGeneralRole = accounts.some(
    (a) => a.isActive && a.roles.includes("general_notifications"),
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading email accounts…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-100">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">Email</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Configure SMTP accounts for outbound email. Assign roles so forgot
            password and signup confirmation use General notifications, and
            future billing mail uses Billing notifications. Each role can be
            assigned to only one account.
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

      {!hasGeneralRole && (
        <div className="mx-6 mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          No active account has the <strong>General notifications</strong> role.
          Forgot password and signup confirmation emails will not send until you
          edit an account and assign that role.
        </div>
      )}

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="border-b border-neutral-100 px-6 py-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {editingId ? "Edit email account" : "Add email account"}
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
                placeholder="Main transactional SMTP"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                SMTP host
              </span>
              <input
                required
                value={form.host}
                onChange={(e) => field("host", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="smtp.example.com"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Port</span>
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => field("port", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="587"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Username
              </span>
              <input
                required
                value={form.username}
                onChange={(e) => field("username", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="smtp-user@example.com"
                autoComplete="off"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Password{editingId ? " (leave blank to keep current)" : ""}
              </span>
              <PasswordInput
                required={!editingId}
                value={form.password}
                onChange={(e) => field("password", e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder={editingId ? "••••••••" : "SMTP password"}
              />
              {editingId && (
                <span className="mt-1 block text-[11px] text-neutral-500">
                  Currently:{" "}
                  {editingAccount?.hasPassword ? (
                    <span className="text-green-700">password set</span>
                  ) : (
                    <span className="text-red-600">missing</span>
                  )}
                </span>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                From name
              </span>
              <input
                required
                value={form.fromName}
                onChange={(e) => field("fromName", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="GRAC CRM"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                From email
              </span>
              <input
                required
                type="email"
                value={form.fromEmail}
                onChange={(e) => field("fromEmail", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="noreply@example.com"
              />
            </label>

            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.secure}
                onChange={(e) => field("secure", e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
              />
              <span className="text-sm text-neutral-700">
                Use TLS/SSL (secure) — typically for port 465
              </span>
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

            <fieldset className="sm:col-span-2 space-y-2">
              <legend className="text-xs font-medium text-neutral-600">
                Notification roles
              </legend>
              <p className="text-[11px] text-neutral-500">
                Assigning a role here removes it from any other account.
              </p>
              {ROLE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-start gap-2 rounded-md border border-neutral-200 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={form.roles.includes(opt.value)}
                    onChange={() => toggleRole(opt.value)}
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
                  />
                  <span>
                    <span className="block text-sm font-medium text-brand-dark">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {opt.hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
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
          No email accounts configured yet. Add an SMTP account and assign
          General notifications to enable password reset and signup emails.
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
                  From
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Host
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Roles
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
                      {account.hasPassword
                        ? "Password set"
                        : "Missing password"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-neutral-600">
                    <div className="whitespace-nowrap">{account.fromName}</div>
                    <div className="text-xs text-neutral-400">
                      {account.fromEmail}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-neutral-600 whitespace-nowrap">
                    {account.host}:{account.port}
                    {account.secure ? " (TLS)" : ""}
                  </td>
                  <td className="px-6 py-4">
                    {account.roles.length === 0 ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {account.roles.map((role) => (
                          <span
                            key={role}
                            className="inline-flex rounded-full bg-brand-dark/5 px-2 py-0.5 text-xs font-medium text-brand-dark"
                          >
                            {ROLE_BADGE_LABELS[role]}
                          </span>
                        ))}
                      </div>
                    )}
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
                      onClick={() => handleSendTest(account)}
                      disabled={
                        !account.isActive ||
                        !account.hasPassword ||
                        testingId === account._id
                      }
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark disabled:opacity-50"
                      aria-label={`Send test email via ${account.friendlyName}`}
                      title="Send test email"
                    >
                      <Mail className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(account)}
                      className="ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
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
          {testFeedback && (
            <div
              className={`mx-6 mb-4 mt-2 rounded-md border px-4 py-3 text-sm ${
                testFeedback.ok
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {testFeedback.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
