"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import PasswordInput from "@/components/ui/PasswordInput";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import {
  ApiError,
  createPaymentProviderAccount,
  deletePaymentProviderAccount,
  getPaymentProviderAccounts,
  getUsers,
  PaymentProviderAccountItem,
  PaymentProviderName,
  saveSquareOAuthApp,
  SquareOAuthStatus,
  startSquareOAuth,
  updatePaymentProviderAccount,
  UserListItem,
} from "@/lib/api";

type FormState = {
  provider: PaymentProviderName;
  friendlyName: string;
  environment: "sandbox" | "production";
  ownerUserId: string;
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
  ownerUserId: "",
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

const ORG_ADMIN_ROLES = ["admin", "super-admin"];

function ownerLabel(owner: {
  first_name: string;
  last_name: string;
  email: string;
}): string {
  const name = `${owner.first_name} ${owner.last_name}`.trim();
  return name || owner.email;
}

export default function PaymentProvidersCard() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const searchParams = useSearchParams();
  const isOrgAdmin = user ? ORG_ADMIN_ROLES.includes(user.role) : false;
  const isOwner = user?.role === "owner";

  const [accounts, setAccounts] = useState<PaymentProviderAccountItem[]>([]);
  const [webhooks, setWebhooks] = useState<Record<string, string> | null>(null);
  const [squareOAuth, setSquareOAuth] = useState<SquareOAuthStatus | null>(null);
  const [owners, setOwners] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [oauthEnvironment, setOauthEnvironment] = useState<
    "sandbox" | "production"
  >("production");
  const [oauthOwnerUserId, setOauthOwnerUserId] = useState("");
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const [appFormOpen, setAppFormOpen] = useState(false);
  const [appProductionId, setAppProductionId] = useState("");
  const [appProductionSecret, setAppProductionSecret] = useState("");
  const [appSandboxId, setAppSandboxId] = useState("");
  const [appSandboxSecret, setAppSandboxSecret] = useState("");
  const [appSaving, setAppSaving] = useState(false);
  const [appSaveError, setAppSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const editingAccount = useMemo(
    () => accounts.find((a) => a._id === editingId) ?? null,
    [accounts, editingId],
  );
  const isEditingOauth = editingAccount?.authMethod === "oauth";

  const oauthReady =
    oauthEnvironment === "sandbox"
      ? Boolean(squareOAuth?.sandbox)
      : Boolean(squareOAuth?.production);

  const connectedSquareAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.provider === "square" && a.authMethod === "oauth" && a.isActive,
      ),
    [accounts],
  );

  const hasConnectedSquare = connectedSquareAccounts.length > 0;

  const oauthReturnStatus = searchParams.get("square_oauth");
  const oauthReturnMessage = searchParams.get("message");
  const banner =
    !bannerDismissed && oauthReturnStatus
      ? {
          type: (oauthReturnStatus === "success" ? "success" : "error") as
            | "success"
            | "error",
          message:
            oauthReturnMessage ||
            (oauthReturnStatus === "success"
              ? "Square account connected."
              : "Square OAuth failed."),
        }
      : null;

  useEffect(() => {
    if (!oauthReturnStatus || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("square_oauth")) return;
    url.searchParams.delete("square_oauth");
    url.searchParams.delete("message");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [oauthReturnStatus]);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const [{ accounts: list, webhooks: hooks, squareOAuth: oauth }, usersRes] =
          await Promise.all([
            getPaymentProviderAccounts(token),
            isOrgAdmin
              ? getUsers(token).catch(() => ({ users: [] as UserListItem[] }))
              : Promise.resolve({ users: [] as UserListItem[] }),
          ]);
        setAccounts(list);
        setWebhooks(hooks);
        setSquareOAuth(oauth);
        setAppProductionId(oauth.app?.productionApplicationId ?? "");
        setAppSandboxId(oauth.app?.sandboxApplicationId ?? "");
        // Prefer whichever environment is already configured for one-click sign-in.
        if (oauth.production) {
          setOauthEnvironment("production");
        } else if (oauth.sandbox) {
          setOauthEnvironment("sandbox");
        }
        setOwners(usersRes.users.filter((u) => u.role === "owner"));
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load payment providers.",
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [token, isOrgAdmin]);

  function openCreate() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      ownerUserId: isOwner && user ? user.id : "",
    });
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(account: PaymentProviderAccountItem) {
    setEditingId(account._id);
    setForm({
      provider: account.provider,
      friendlyName: account.friendlyName,
      environment: account.environment,
      ownerUserId: account.ownerUserRef ?? "",
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

  function upsertAccountInList(account: PaymentProviderAccountItem) {
    setAccounts((prev) => {
      const without = prev.filter((a) => a._id !== account._id);
      const clearedDefaults = without.map((a) => {
        const sameScope =
          (a.ownerUserRef ?? null) === (account.ownerUserRef ?? null);
        if (account.isDefault && sameScope && a.isDefault) {
          return { ...a, isDefault: false };
        }
        return a;
      });
      return [...clearedDefaults, account].sort((a, b) =>
        a.provider === b.provider
          ? a.friendlyName.localeCompare(b.friendlyName)
          : a.provider.localeCompare(b.provider),
      );
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setSaveError(null);

    const ownerUserId = isOwner
      ? user?.id ?? null
      : form.ownerUserId.trim()
        ? form.ownerUserId.trim()
        : null;

    const payload = {
      provider: form.provider,
      friendlyName: form.friendlyName.trim(),
      environment: form.environment,
      isActive: form.isActive,
      isDefault: form.isDefault,
      ownerUserId,
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
        upsertAccountInList(account);
      } else {
        const { account } = await createPaymentProviderAccount(token, payload);
        upsertAccountInList(account);
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

  async function handleConnectSquare() {
    if (!token) return;
    setOauthConnecting(true);
    setOauthError(null);
    try {
      const ownerUserId = isOwner
        ? user?.id ?? null
        : oauthOwnerUserId.trim()
          ? oauthOwnerUserId.trim()
          : null;
      const { authorizeUrl } = await startSquareOAuth(token, {
        environment: oauthEnvironment,
        ownerUserId,
      });
      window.location.href = authorizeUrl;
    } catch (err) {
      setOauthError(
        err instanceof ApiError
          ? err.message
          : "Failed to start Square OAuth.",
      );
      setOauthConnecting(false);
    }
  }

  async function handleSaveSquareApp(e: FormEvent) {
    e.preventDefault();
    if (!token || !isOrgAdmin) return;
    setAppSaving(true);
    setAppSaveError(null);
    try {
      const { squareOAuth: oauth } = await saveSquareOAuthApp(token, {
        productionApplicationId: appProductionId.trim(),
        sandboxApplicationId: appSandboxId.trim(),
        productionApplicationSecret: appProductionSecret.trim() || undefined,
        sandboxApplicationSecret: appSandboxSecret.trim() || undefined,
      });
      setSquareOAuth(oauth);
      setAppProductionId(oauth.app?.productionApplicationId ?? "");
      setAppSandboxId(oauth.app?.sandboxApplicationId ?? "");
      setAppProductionSecret("");
      setAppSandboxSecret("");
      setAppFormOpen(false);
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldMessages = err.errors
          ? Object.values(err.errors).flat().filter(Boolean)
          : [];
        setAppSaveError(
          fieldMessages.length > 0
            ? fieldMessages.join(" ")
            : err.message,
        );
      } else {
        setAppSaveError("Failed to save Square application credentials.");
      }
    } finally {
      setAppSaving(false);
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
            Sign in with Square to link a seller account — no access tokens or
            API keys to paste.{" "}
            {isOrgAdmin
              ? "Admins can assign the connection to an owner or keep it as a global fallback."
              : "This connects payments for your territory customers."}
          </p>
        </div>
      </div>

      {banner && (
        <div
          className={
            banner.type === "success"
              ? "mx-6 mt-4 flex items-start justify-between gap-3 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800"
              : "mx-6 mt-4 flex items-start justify-between gap-3 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
          }
        >
          <span>{banner.message}</span>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mx-6 mt-4 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-5 space-y-4">
        <div>
          <p className="text-base font-semibold text-brand-dark">
            Sign in with Square
          </p>
          <p className="text-sm text-neutral-600 mt-1">
            {hasConnectedSquare
              ? "Your Square account is linked. Sign in again to reconnect or switch sellers."
              : "Log in to Square in the next step. We save the connection automatically — you do not enter Application IDs, access tokens, or location IDs."}
          </p>
        </div>

        {hasConnectedSquare && (
          <ul className="space-y-2">
            {connectedSquareAccounts.map((account) => (
              <li
                key={account._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium text-green-900">
                    {account.friendlyName}
                  </p>
                  <p className="text-xs text-green-800/80">
                    {account.owner
                      ? `Owner: ${ownerLabel(account.owner)}`
                      : "Global fallback"}{" "}
                    · {account.environment}
                    {account.locationId ? ` · Location ${account.locationId}` : ""}
                  </p>
                </div>
                <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  Connected
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isOrgAdmin && (
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Environment
              </span>
              <select
                value={oauthEnvironment}
                onChange={(e) =>
                  setOauthEnvironment(
                    e.target.value as "sandbox" | "production",
                  )
                }
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              >
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </label>
          )}

          {isOrgAdmin ? (
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Link to owner
              </span>
              <select
                value={oauthOwnerUserId}
                onChange={(e) => setOauthOwnerUserId(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              >
                <option value="">Global fallback</option>
                {owners.map((o) => (
                  <option key={o._id} value={o._id}>
                    {ownerLabel(o)} ({o.email})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-neutral-600 sm:col-span-2">
              Signing in links Square to <span className="font-medium">your</span>{" "}
              owner account.
            </p>
          )}
        </div>

        {oauthError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {oauthError}
          </div>
        )}

        {!oauthReady && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-2">
            <p>
              Square sign-in is not available yet for{" "}
              <span className="font-medium">{oauthEnvironment}</span>.
            </p>
            {isOrgAdmin ? (
              <p>
                A one-time platform setup is required: open{" "}
                <button
                  type="button"
                  className="underline font-medium"
                  onClick={() => {
                    setAdvancedOpen(true);
                    setAppFormOpen(true);
                  }}
                >
                  Advanced → Square app settings
                </button>{" "}
                (or set server env vars), then register the{" "}
                <span className="font-medium">OAuth Redirect URL</span>{" "}
                {squareOAuth?.callbackUrl ? (
                  <code className="break-all">{squareOAuth.callbackUrl}</code>
                ) : (
                  "(set PUBLIC_API_URL first)"
                )}{" "}
                on Square Developer Dashboard → OAuth (not Webhooks). After
                that, everyone only uses Sign in with Square.
              </p>
            ) : (
              <p>
                Ask an admin to finish Square app setup. You will only need to
                sign in with Square — no keys to enter.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleConnectSquare()}
          disabled={oauthConnecting || !oauthReady}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-md bg-[#006AFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0058d6] disabled:opacity-60"
        >
          {oauthConnecting
            ? "Opening Square…"
            : hasConnectedSquare
              ? "Sign in with Square again"
              : "Sign in with Square"}
        </button>
      </div>

      <div className="mx-6 mt-4 border border-neutral-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          <span>Advanced</span>
          <span className="text-xs font-normal text-neutral-500">
            {advancedOpen
              ? "Hide"
              : isOrgAdmin
                ? "App settings, webhooks, manual keys"
                : "Manual credentials (optional)"}
          </span>
        </button>

        {advancedOpen && (
          <div className="border-t border-neutral-100 px-4 py-4 space-y-4 bg-neutral-50/80">
            {isOrgAdmin && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-dark">
                    Square app settings
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAppFormOpen((open) => !open);
                      setAppSaveError(null);
                    }}
                    className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                  >
                    {appFormOpen ? "Close" : "Configure"}
                  </button>
                </div>
                <p className="text-xs text-neutral-500">
                  One-time platform Application ID +{" "}
                  <span className="font-medium">OAuth</span> Application Secret
                  from Square Developer Dashboard → your app → OAuth. Do not use
                  Credentials-page secrets or access tokens. Sellers never see
                  these.
                </p>
                {appFormOpen && (
                  <form
                    onSubmit={handleSaveSquareApp}
                    className="rounded-md border border-neutral-200 bg-white px-3 py-3 space-y-3"
                  >
                    <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 space-y-1.5">
                      <p className="font-semibold">
                        Square OAuth Redirect URL (required)
                      </p>
                      <p>
                        Paste this exact value under Square Developer Dashboard
                        → your app →{" "}
                        <span className="font-medium">OAuth</span> → Redirect
                        URL. Using the webhook path here causes{" "}
                        <code className="font-mono">
                          Invalid value for parameter redirect_uri
                        </code>
                        .
                      </p>
                      <code className="block break-all rounded bg-white/80 px-2 py-1.5 font-mono text-[11px] text-neutral-800 border border-amber-100">
                        {squareOAuth?.callbackUrl ||
                          "https://YOUR_API_HOST/payment-provider-accounts/square/oauth/callback"}
                      </code>
                      <p>
                        A wrong Application Secret (Credentials page or access
                        token) causes{" "}
                        <code className="font-mono">
                          Square token exchange failed: Not Authorized
                        </code>{" "}
                        after Sign in with Square succeeds.
                      </p>
                    </div>
                    {appSaveError && (
                      <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                        {appSaveError}
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block sm:col-span-2">
                        <span className="text-xs font-medium text-neutral-600">
                          Production Application ID
                          {squareOAuth?.app?.envConfigured.production
                            ? " (overridden by server env)"
                            : ""}
                        </span>
                        <input
                          value={appProductionId}
                          onChange={(e) => setAppProductionId(e.target.value)}
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                          placeholder="sq0idp-…"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-xs font-medium text-neutral-600">
                          Production OAuth Application Secret
                          {squareOAuth?.app?.hasProductionApplicationSecret
                            ? " (leave blank to keep)"
                            : ""}
                        </span>
                        <p className="mt-0.5 text-[11px] text-neutral-500">
                          From Square → OAuth → Application Secret (starts with{" "}
                          <code>sq0csp-</code>). Not the Credentials secret or
                          access token.
                        </p>
                        <PasswordInput
                          value={appProductionSecret}
                          onChange={(e) =>
                            setAppProductionSecret(e.target.value)
                          }
                          autoComplete="new-password"
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                          placeholder={
                            squareOAuth?.app?.hasProductionApplicationSecret
                              ? "••••••••"
                              : "sq0csp-…"
                          }
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-xs font-medium text-neutral-600">
                          Sandbox Application ID
                          {squareOAuth?.app?.envConfigured.sandbox
                            ? " (overridden by server env)"
                            : ""}
                        </span>
                        <input
                          value={appSandboxId}
                          onChange={(e) => setAppSandboxId(e.target.value)}
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                          placeholder="sandbox-sq0idb-…"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-xs font-medium text-neutral-600">
                          Sandbox OAuth Application Secret
                          {squareOAuth?.app?.hasSandboxApplicationSecret
                            ? " (leave blank to keep)"
                            : ""}
                        </span>
                        <p className="mt-0.5 text-[11px] text-neutral-500">
                          From Square → OAuth (Sandbox) → Application Secret
                          (starts with <code>sandbox-sq0csb-</code>).
                        </p>
                        <PasswordInput
                          value={appSandboxSecret}
                          onChange={(e) => setAppSandboxSecret(e.target.value)}
                          autoComplete="new-password"
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                          placeholder={
                            squareOAuth?.app?.hasSandboxApplicationSecret
                              ? "••••••••"
                              : "sandbox-sq0csb-…"
                          }
                        />
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={appSaving}
                        className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
                      >
                        {appSaving ? "Saving…" : "Save Square app"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {isOrgAdmin && webhooks ? (
              <div className="rounded-md border border-neutral-200 bg-white px-3 py-3 text-xs text-neutral-600 space-y-2">
                <p className="font-semibold text-brand-dark">Webhook URLs</p>
                <p className="text-neutral-500">
                  Register these under each provider&apos;s{" "}
                  <span className="font-medium">Webhooks</span> settings — not
                  as the Square OAuth Redirect URL.
                </p>
                <div>
                  <span className="font-medium">Square (Webhooks only):</span>{" "}
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
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-brand-dark">
                    Manual credentials
                  </p>
                  <p className="text-xs text-neutral-500">
                    Optional fallback if you cannot use Square sign-in.
                  </p>
                </div>
                {!formOpen && (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add manually
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="border-b border-neutral-100 px-6 py-5 space-y-4 mt-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-dark">
              {editingId
                ? isEditingOauth
                  ? "Edit Square OAuth account"
                  : "Edit payment provider"
                : "Add payment provider (manual)"}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                disabled={isEditingOauth}
                value={form.environment}
                onChange={(e) =>
                  field(
                    "environment",
                    e.target.value as "sandbox" | "production",
                  )
                }
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark disabled:bg-neutral-50"
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

            {isOrgAdmin ? (
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-neutral-600">
                  Assign to owner
                </span>
                <select
                  value={form.ownerUserId}
                  onChange={(e) => field("ownerUserId", e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
                >
                  <option value="">Global fallback</option>
                  {owners.map((o) => (
                    <option key={o._id} value={o._id}>
                      {ownerLabel(o)} ({o.email})
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-neutral-500">
                  Owner-scoped accounts are used for that owner&apos;s
                  customers. Global is the fallback when no owner account
                  exists.
                </span>
              </label>
            ) : null}

            {form.provider === "square" && (
              <>
                {!isEditingOauth && (
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
                )}
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
                {!isEditingOauth && (
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
                )}
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
                {isEditingOauth ? (
                  <p className="sm:col-span-2 text-xs text-neutral-500">
                    Access tokens for OAuth accounts refresh automatically. Use
                    Connect with Square again to reconnect this seller.
                  </p>
                ) : null}
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
                Default for this scope
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
          No Square account linked yet. Use{" "}
          <span className="font-medium text-neutral-700">Sign in with Square</span>{" "}
          above to connect — no API keys required.
        </div>
      ) : (
        <div className="px-4 pb-4 mt-2 sm:px-0 sm:pb-0">
          <ResponsiveDataView
            mobile={accounts.map((account) => {
              const credentialHint =
                account.provider === "square"
                  ? account.hasAccessToken
                    ? "Access token set"
                    : "Missing access token"
                  : account.provider === "stripe"
                    ? account.hasSecretKey
                      ? "Secret key set"
                      : "Missing secret key"
                    : account.hasClientSecret
                      ? "Client secret set"
                      : "Missing client secret";
              return (
                <MobileDataCard
                  key={account._id}
                  title={account.friendlyName}
                  subtitle={`${PROVIDER_LABELS[account.provider]} · ${credentialHint}`}
                  badges={
                    <>
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
                      <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium capitalize text-neutral-600">
                        {account.environment}
                      </span>
                    </>
                  }
                  fields={
                    <>
                      <DataField
                        label="Owner"
                        value={
                          account.owner
                            ? ownerLabel(account.owner)
                            : "Global fallback"
                        }
                      />
                      <DataField
                        label="Auth"
                        value={
                          <span className="capitalize">
                            {account.authMethod}
                          </span>
                        }
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
              );
            })}
            desktop={
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
                        Owner
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
                          <div className="mt-0.5 text-xs font-normal text-neutral-400 capitalize">
                            {account.authMethod}
                          </div>
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
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {account.owner
                            ? ownerLabel(account.owner)
                            : "Global fallback"}
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
            }
          />
        </div>
      )}
    </div>
  );
}
