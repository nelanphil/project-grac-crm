"use client";

import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import PasswordInput from "@/components/ui/PasswordInput";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import {
  ApiError,
  createTwilioAccount,
  deleteTwilioAccount,
  getMessagingWebhookInfo,
  getTwilioAccounts,
  MessagingWebhookInfo,
  TwilioAccountItem,
  TwilioRuntimeEnvironment,
  updateTwilioAccount,
} from "@/lib/api";

type FormState = {
  friendlyName: string;
  accountSid: string;
  authToken: string;
  testAccountSid: string;
  testAuthToken: string;
  clearTestAuthToken: boolean;
  phoneNumbers: string;
  isActive: boolean;
  sayVoice: string;
};

const SAY_VOICES = [
  { value: "Polly.Joanna", label: "Joanna (Amazon Polly)" },
  { value: "Polly.Matthew", label: "Matthew (Amazon Polly)" },
  { value: "Polly.Joey", label: "Joey (Amazon Polly)" },
  { value: "Polly.Salli", label: "Salli (Amazon Polly)" },
  { value: "Google.en-US-Neural2-F", label: "Neural female (Google)" },
  { value: "Google.en-US-Neural2-D", label: "Neural male (Google)" },
  { value: "alice", label: "Alice (legacy)" },
] as const;

const DEFAULT_SAY_VOICE = "Polly.Joanna";

const EMPTY_FORM: FormState = {
  friendlyName: "",
  accountSid: "",
  authToken: "",
  testAccountSid: "",
  testAuthToken: "",
  clearTestAuthToken: false,
  phoneNumbers: "",
  isActive: true,
  sayVoice: DEFAULT_SAY_VOICE,
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

function environmentLabel(environment: TwilioRuntimeEnvironment): string {
  return environment === "production" ? "Production" : "Development";
}

function webhookHostIsPublic(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !(
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      !host.includes(".")
    );
  } catch {
    return false;
  }
}

function EnvironmentBadge({
  environment,
}: {
  environment: TwilioRuntimeEnvironment;
}) {
  const production = environment === "production";
  return (
    <span
      className={
        production
          ? "inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800"
          : "inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
      }
    >
      {environmentLabel(environment)}
    </span>
  );
}

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? "inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
          : "inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500"
      }
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function AccountStatusBadges({ account }: { account: TwilioAccountItem }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <EnvironmentBadge environment={account.environment} />
      <ActiveBadge isActive={account.isActive} />
    </span>
  );
}

export default function TwilioAccountsCard() {
  const token = useAuthStore((s) => s.token);

  const [accounts, setAccounts] = useState<TwilioAccountItem[]>([]);
  const [webhookInfo, setWebhookInfo] = useState<MessagingWebhookInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] =
    useState<TwilioAccountItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);
    Promise.all([getTwilioAccounts(token), getMessagingWebhookInfo(token)])
      .then(([{ accounts: list }, hooks]) => {
        setAccounts(list);
        setWebhookInfo(hooks);
      })
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
    setEditingAccount(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(account: TwilioAccountItem) {
    setEditingId(account._id);
    setEditingAccount(account);
    setForm({
      friendlyName: account.friendlyName,
      accountSid: account.accountSid,
      authToken: "",
      testAccountSid: account.testAccountSid ?? "",
      testAuthToken: "",
      clearTestAuthToken: false,
      phoneNumbers: account.phoneNumbers.join(", "),
      isActive: account.isActive,
      sayVoice: account.sayVoice || DEFAULT_SAY_VOICE,
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setSaveError(null);

    const payload = {
      friendlyName: form.friendlyName.trim(),
      accountSid: form.accountSid.trim(),
      authToken: form.authToken.trim() || undefined,
      testAccountSid: form.testAccountSid.trim(),
      testAuthToken: form.clearTestAuthToken
        ? null
        : form.testAuthToken.trim() || undefined,
      phoneNumbers: parsePhoneNumbers(form.phoneNumbers),
      isActive: form.isActive,
      sayVoice: form.sayVoice,
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
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-brand-dark">Twilio</h2>
            {webhookInfo ? (
              <EnvironmentBadge environment={webhookInfo.environment} />
            ) : accounts[0] ? (
              <EnvironmentBadge environment={accounts[0].environment} />
            ) : null}
          </div>
          <p className="text-sm text-neutral-500 mt-0.5">
            Configure Twilio accounts for SMS, MMS, and phone calls. Incoming
            calls must use the Voice URL on Twilio&apos;s Voice tab — not the
            Messaging tab, and not the status callback.
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

      {webhookInfo ? (
        <div className="mx-6 mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600 space-y-2">
          <p className="font-semibold text-brand-dark">Webhook URLs</p>
          <p>
            Match Twilio Console labels. Incoming <strong>calls</strong> belong
            on the <strong>Voice configuration</strong> tab. Incoming{" "}
            <strong>SMS</strong> belongs on the <strong>Messaging</strong> tab.
            Status callback is delivery / call-progress only — it returns{" "}
            <code>OK</code>, not TwiML, so never use it as the Voice URL or as
            the Messaging backup.
          </p>
          <div>
            <span className="font-medium">
              Voice webhook (A call comes in):
            </span>{" "}
            <code className="break-all">{webhookInfo.voiceWebhookUrl}</code>
            <span className="mt-0.5 block text-neutral-500">
              Voice configuration tab. Saving a number here also pushes this
              URL when the API is public.
            </span>
          </div>
          <div>
            <span className="font-medium">
              Messaging webhook (A message comes in):
            </span>{" "}
            <code className="break-all">{webhookInfo.messageWebhookUrl}</code>
            <span className="mt-0.5 block text-neutral-500">
              Messaging tab, primary handler.
            </span>
          </div>
          <div>
            <span className="font-medium">Status callback:</span>{" "}
            <code className="break-all">{webhookInfo.statusWebhookUrl}</code>
            <span className="mt-0.5 block text-neutral-500">
              StatusCallback / call status changes only — not Messaging backup.
            </span>
          </div>
          <div>
            <span className="font-medium">Recording / transcription:</span>{" "}
            <code className="break-all">
              {webhookInfo.recordingWebhookUrl}
            </code>
            <span className="mt-0.5 block text-neutral-500">
              Applied by TwiML when a caller leaves voicemail — not a number
              field in Twilio Console.
            </span>
          </div>
          <p className="text-neutral-500">
            {webhookHostIsPublic(webhookInfo.voiceWebhookUrl)
              ? "This API host is public, so saving an account pushes Voice, Messaging, and Status URLs onto each listed number."
              : "Voice, Messaging, and Status URLs are not pushed to Twilio until this API is publicly reachable (localhost cannot receive Twilio callbacks)."}{" "}
            Optional per-account URLs include <code>?accountSid=AC…</code> for
            unambiguous routing when multiple Twilio accounts share this CRM.
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
          {(webhookInfo || editingAccount) && (
            <p className="text-xs text-neutral-500">
              This server is{" "}
              {environmentLabel(
                webhookInfo?.environment ??
                  editingAccount?.environment ??
                  "development",
              )}{" "}
              · account is {form.isActive ? "Active" : "Inactive"} · using{" "}
              {(webhookInfo?.credentialsInUse ??
                editingAccount?.credentialsInUse) === "live"
                ? "live"
                : "test"}{" "}
              Account SID.
            </p>
          )}

          {saveError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <PasswordInput
                required={!editingId}
                value={form.authToken}
                onChange={(e) => field("authToken", e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder={editingId ? "••••••••" : "Live auth token"}
              />
              {editingId && (
                <span className="mt-1 block text-[11px] text-neutral-500">
                  Currently:{" "}
                  {editingAccount?.hasAuthToken ? (
                    <span className="text-green-700">
                      set (hidden for security)
                    </span>
                  ) : (
                    <span className="text-red-600">not set</span>
                  )}
                  . Field stays blank on purpose — type a new value only to
                  replace it.
                </span>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Test account SID (optional)
              </span>
              <input
                value={form.testAccountSid}
                onChange={(e) => field("testAccountSid", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <span className="mt-1 block text-[11px] text-neutral-500">
                Twilio&apos;s special Test Account SID (found on the Twilio
                console). Must be paired with the test auth token below — a test
                auth token alone will NOT work and will fail to authenticate.
                This field shows the real stored value — clear it and save to
                remove it.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Test auth token
                {editingId ? " (leave blank to keep)" : " (optional)"}
              </span>
              <PasswordInput
                value={form.testAuthToken}
                onChange={(e) => field("testAuthToken", e.target.value)}
                disabled={form.clearTestAuthToken}
                autoComplete="new-password"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark disabled:bg-neutral-100"
                placeholder={editingId ? "••••••••" : "Test auth token"}
              />
              {editingId && (
                <>
                  <span className="mt-1 block text-[11px] text-neutral-500">
                    Currently:{" "}
                    {editingAccount?.hasTestAuthToken ? (
                      <span className="text-amber-700">
                        set (hidden for security)
                      </span>
                    ) : (
                      <span className="text-neutral-500">not set</span>
                    )}
                    . Field stays blank on purpose — type a new value only to
                    replace it.
                  </span>
                  <label className="mt-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.clearTestAuthToken}
                      onChange={(e) => {
                        field("clearTestAuthToken", e.target.checked);
                        if (e.target.checked) field("testAuthToken", "");
                      }}
                      className="h-4 w-4 rounded border-neutral-300 text-brand-dark focus:ring-brand-dark"
                    />
                    <span className="text-xs text-neutral-700">
                      Clear stored test auth token on save
                    </span>
                  </label>
                </>
              )}
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

            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-neutral-600">
                Spoken voice (IVR, voicemail, outbound calls)
              </span>
              <select
                value={form.sayVoice}
                onChange={(e) => field("sayVoice", e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              >
                {SAY_VOICES.map((voice) => (
                  <option key={voice.value} value={voice.value}>
                    {voice.label}
                  </option>
                ))}
              </select>
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
        <div className="px-4 pb-4 sm:px-0 sm:pb-0">
          <ResponsiveDataView
            mobile={accounts.map((account) => (
              <MobileDataCard
                key={account._id}
                title={account.friendlyName}
                subtitle={
                  <>
                    {account.credentialsInUse === "live"
                      ? "Using live credentials"
                      : "Using test credentials"}
                    {" · "}
                    {account.hasAuthToken
                      ? "Auth token set"
                      : "Missing auth token"}
                  </>
                }
                badges={<AccountStatusBadges account={account} />}
                fields={
                  <>
                    <DataField
                      label="Account SID"
                      value={
                        <span className="font-mono">
                          {maskSid(account.accountSid)}
                        </span>
                      }
                      className="col-span-2"
                    />
                    <DataField
                      label="Phones"
                      value={
                        account.phoneNumbers.length > 0
                          ? account.phoneNumbers.join(", ")
                          : "—"
                      }
                      className="col-span-2"
                    />
                  </>
                }
                actions={
                  <div className="flex items-center gap-0.5">
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
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label={`Delete ${account.friendlyName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                }
              />
            ))}
            desktop={
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
                            {account.credentialsInUse === "live"
                              ? "Using live credentials"
                              : "Using test credentials"}
                            {account.hasAuthToken
                              ? " · Auth token set"
                              : " · Missing auth token"}
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
                          <AccountStatusBadges account={account} />
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
            }
          />
        </div>
      )}
    </div>
  );
}
