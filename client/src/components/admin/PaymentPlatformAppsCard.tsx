"use client";

import { FormEvent, useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import PasswordInput from "@/components/ui/PasswordInput";
import {
  ApiError,
  getPaymentPlatformApps,
  PaymentPlatformAppsPayload,
  PayPalPlatformAppStatus,
  savePaymentPlatformApp,
  SquareOAuthStatus,
  StripePlatformAppStatus,
} from "@/lib/api";

type ProviderId = "square" | "stripe" | "paypal";

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={
        configured
          ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
          : "rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500"
      }
    >
      {configured ? "Configured" : "Not configured"}
    </span>
  );
}

function envLabel(sandbox: boolean, production: boolean): string {
  const parts: string[] = [];
  if (production) parts.push("Production");
  if (sandbox) parts.push("Sandbox");
  return parts.length ? parts.join(" · ") : "No environments ready";
}

export default function PaymentPlatformAppsCard({
  token,
}: {
  token: string | null;
}) {
  const [apps, setApps] = useState<PaymentPlatformAppsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProviderId | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const payload = await getPaymentPlatformApps(token!);
        if (!cancelled) setApps(payload);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load payment platform settings.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
        Loading payment platforms…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-100 p-2 text-amber-800">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-dark">
              Payment platforms
            </h2>
            <p className="text-sm text-neutral-500 mt-0.5">
              Platform app credentials for Square, Stripe, and PayPal. Owners
              connect their seller accounts from Control Panel after these keys
              are saved.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {apps && (
        <div className="divide-y divide-neutral-100">
          <SquareSection
            token={token}
            square={apps.square}
            editing={editing === "square"}
            onToggle={() =>
              setEditing((prev) => (prev === "square" ? null : "square"))
            }
            onSaved={setApps}
          />
          <StripeSection
            token={token}
            stripe={apps.stripe}
            editing={editing === "stripe"}
            onToggle={() =>
              setEditing((prev) => (prev === "stripe" ? null : "stripe"))
            }
            onSaved={setApps}
          />
          <PayPalSection
            token={token}
            paypal={apps.paypal}
            editing={editing === "paypal"}
            onToggle={() =>
              setEditing((prev) => (prev === "paypal" ? null : "paypal"))
            }
            onSaved={setApps}
          />
        </div>
      )}
    </div>
  );
}

function SquareSection({
  token,
  square,
  editing,
  onToggle,
  onSaved,
}: {
  token: string | null;
  square: SquareOAuthStatus;
  editing: boolean;
  onToggle: () => void;
  onSaved: (apps: PaymentPlatformAppsPayload) => void;
}) {
  const [productionId, setProductionId] = useState(
    square.app?.productionApplicationId ?? "",
  );
  const [sandboxId, setSandboxId] = useState(
    square.app?.sandboxApplicationId ?? "",
  );
  const [productionSecret, setProductionSecret] = useState("");
  const [sandboxSecret, setSandboxSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setProductionId(square.app?.productionApplicationId ?? "");
    setSandboxId(square.app?.sandboxApplicationId ?? "");
    setProductionSecret("");
    setSandboxSecret("");
    setSaveError(null);
  }, [editing, square]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await savePaymentPlatformApp(token, "square", {
        productionApplicationId: productionId.trim(),
        sandboxApplicationId: sandboxId.trim(),
        productionApplicationSecret: productionSecret.trim() || undefined,
        sandboxApplicationSecret: sandboxSecret.trim() || undefined,
      });
      onSaved(saved);
      onToggle();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save Square application credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  const configured = Boolean(square.sandbox || square.production);

  return (
    <section className="px-6 py-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-brand-dark">Square</h3>
            <StatusBadge configured={configured} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {envLabel(square.sandbox, square.production)}. Application ID +
            OAuth Application Secret from Square Developer Dashboard → your app
            → OAuth.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          {editing ? "Close" : configured ? "Edit" : "Configure"}
        </button>
      </div>

      {editing && (
        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-neutral-200 bg-neutral-50/80 px-4 py-4 space-y-3"
        >
          <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 space-y-1.5">
            <p className="font-semibold">Square OAuth Redirect URL (required)</p>
            <p>
              Paste this exact value under Square Developer Dashboard → your app
              → OAuth → Redirect URL.
            </p>
            <code className="block break-all rounded bg-white/80 px-2 py-1.5 font-mono text-[11px] text-neutral-800 border border-amber-100">
              {square.callbackUrl ||
                "https://YOUR_API_HOST/payment-provider-accounts/square/oauth/callback"}
            </code>
          </div>
          {saveError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {saveError}
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Production Application ID
              {square.app?.envConfigured.production
                ? " (overridden by server env)"
                : ""}
            </span>
            <input
              value={productionId}
              onChange={(e) => setProductionId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="sq0idp-…"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Production OAuth Application Secret
              {square.app?.hasProductionApplicationSecret
                ? " (leave blank to keep)"
                : ""}
            </span>
            <PasswordInput
              value={productionSecret}
              onChange={(e) => setProductionSecret(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder={
                square.app?.hasProductionApplicationSecret
                  ? "••••••••"
                  : "sq0csp-…"
              }
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Sandbox Application ID
              {square.app?.envConfigured.sandbox
                ? " (overridden by server env)"
                : ""}
            </span>
            <input
              value={sandboxId}
              onChange={(e) => setSandboxId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="sandbox-sq0idb-…"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Sandbox OAuth Application Secret
              {square.app?.hasSandboxApplicationSecret
                ? " (leave blank to keep)"
                : ""}
            </span>
            <PasswordInput
              value={sandboxSecret}
              onChange={(e) => setSandboxSecret(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder={
                square.app?.hasSandboxApplicationSecret
                  ? "••••••••"
                  : "sandbox-sq0csb-…"
              }
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Square"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function StripeSection({
  token,
  stripe,
  editing,
  onToggle,
  onSaved,
}: {
  token: string | null;
  stripe: StripePlatformAppStatus;
  editing: boolean;
  onToggle: () => void;
  onSaved: (apps: PaymentPlatformAppsPayload) => void;
}) {
  const [productionPublishableKey, setProductionPublishableKey] = useState(
    stripe.productionPublishableKey,
  );
  const [sandboxPublishableKey, setSandboxPublishableKey] = useState(
    stripe.sandboxPublishableKey,
  );
  const [productionClientId, setProductionClientId] = useState(
    stripe.productionClientId,
  );
  const [sandboxClientId, setSandboxClientId] = useState(stripe.sandboxClientId);
  const [productionSecretKey, setProductionSecretKey] = useState("");
  const [sandboxSecretKey, setSandboxSecretKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setProductionPublishableKey(stripe.productionPublishableKey);
    setSandboxPublishableKey(stripe.sandboxPublishableKey);
    setProductionClientId(stripe.productionClientId);
    setSandboxClientId(stripe.sandboxClientId);
    setProductionSecretKey("");
    setSandboxSecretKey("");
    setSaveError(null);
  }, [editing, stripe]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await savePaymentPlatformApp(token, "stripe", {
        productionPublishableKey: productionPublishableKey.trim(),
        sandboxPublishableKey: sandboxPublishableKey.trim(),
        productionClientId: productionClientId.trim(),
        sandboxClientId: sandboxClientId.trim(),
        productionSecretKey: productionSecretKey.trim() || undefined,
        sandboxSecretKey: sandboxSecretKey.trim() || undefined,
      });
      onSaved(saved);
      onToggle();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save Stripe platform credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="px-6 py-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-brand-dark">Stripe</h3>
            <StatusBadge configured={stripe.configured} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {envLabel(stripe.sandbox, stripe.production)}. Publishable key,
            secret key, and Connect client ID from Stripe Dashboard. Seller
            OAuth on Control Panel comes later.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          {editing ? "Close" : stripe.configured ? "Edit" : "Configure"}
        </button>
      </div>

      {editing && (
        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-neutral-200 bg-neutral-50/80 px-4 py-4 space-y-3"
        >
          {saveError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {saveError}
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Production publishable key
            </span>
            <input
              value={productionPublishableKey}
              onChange={(e) => setProductionPublishableKey(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="pk_live_…"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Production secret key
              {stripe.hasProductionSecretKey ? " (leave blank to keep)" : ""}
            </span>
            <PasswordInput
              value={productionSecretKey}
              onChange={(e) => setProductionSecretKey(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder={stripe.hasProductionSecretKey ? "••••••••" : "sk_live_…"}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Production Connect client ID
            </span>
            <input
              value={productionClientId}
              onChange={(e) => setProductionClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="ca_…"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Sandbox publishable key
            </span>
            <input
              value={sandboxPublishableKey}
              onChange={(e) => setSandboxPublishableKey(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="pk_test_…"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Sandbox secret key
              {stripe.hasSandboxSecretKey ? " (leave blank to keep)" : ""}
            </span>
            <PasswordInput
              value={sandboxSecretKey}
              onChange={(e) => setSandboxSecretKey(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder={stripe.hasSandboxSecretKey ? "••••••••" : "sk_test_…"}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Sandbox Connect client ID
            </span>
            <input
              value={sandboxClientId}
              onChange={(e) => setSandboxClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder="ca_…"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Stripe"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function PayPalSection({
  token,
  paypal,
  editing,
  onToggle,
  onSaved,
}: {
  token: string | null;
  paypal: PayPalPlatformAppStatus;
  editing: boolean;
  onToggle: () => void;
  onSaved: (apps: PaymentPlatformAppsPayload) => void;
}) {
  const [productionClientId, setProductionClientId] = useState(
    paypal.productionClientId,
  );
  const [sandboxClientId, setSandboxClientId] = useState(paypal.sandboxClientId);
  const [productionClientSecret, setProductionClientSecret] = useState("");
  const [sandboxClientSecret, setSandboxClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setProductionClientId(paypal.productionClientId);
    setSandboxClientId(paypal.sandboxClientId);
    setProductionClientSecret("");
    setSandboxClientSecret("");
    setSaveError(null);
  }, [editing, paypal]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await savePaymentPlatformApp(token, "paypal", {
        productionClientId: productionClientId.trim(),
        sandboxClientId: sandboxClientId.trim(),
        productionClientSecret: productionClientSecret.trim() || undefined,
        sandboxClientSecret: sandboxClientSecret.trim() || undefined,
      });
      onSaved(saved);
      onToggle();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save PayPal platform credentials.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="px-6 py-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-brand-dark">PayPal</h3>
            <StatusBadge configured={paypal.configured} />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {envLabel(paypal.sandbox, paypal.production)}. REST API client ID
            and secret from the PayPal Developer Dashboard. Seller OAuth on
            Control Panel comes later.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          {editing ? "Close" : paypal.configured ? "Edit" : "Configure"}
        </button>
      </div>

      {editing && (
        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-neutral-200 bg-neutral-50/80 px-4 py-4 space-y-3"
        >
          {saveError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {saveError}
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Production client ID
            </span>
            <input
              value={productionClientId}
              onChange={(e) => setProductionClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Production client secret
              {paypal.hasProductionClientSecret ? " (leave blank to keep)" : ""}
            </span>
            <PasswordInput
              value={productionClientSecret}
              onChange={(e) => setProductionClientSecret(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder={
                paypal.hasProductionClientSecret ? "••••••••" : "Client secret"
              }
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Sandbox client ID
            </span>
            <input
              value={sandboxClientId}
              onChange={(e) => setSandboxClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">
              Sandbox client secret
              {paypal.hasSandboxClientSecret ? " (leave blank to keep)" : ""}
            </span>
            <PasswordInput
              value={sandboxClientSecret}
              onChange={(e) => setSandboxClientSecret(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
              placeholder={
                paypal.hasSandboxClientSecret ? "••••••••" : "Client secret"
              }
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save PayPal"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
