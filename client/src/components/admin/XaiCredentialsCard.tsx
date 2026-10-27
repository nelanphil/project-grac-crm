"use client";

import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import {
  ApiError,
  XaiCredentialsItem,
  XaiModelChoice,
  deleteXaiCredentials,
  getXaiCredentials,
  listXaiModels,
  saveXaiCredentials,
  testXaiCredentials,
} from "@/lib/api";

const DEFAULT_MODEL = "grok-4";

function modelChoices(models: XaiModelChoice[], current: string): { value: string; label: string }[] {
  const choices: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  function add(value: string) {
    const name = value.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    choices.push({ value: name, label: name });
  }
  for (const model of models) {
    add(model.id);
    for (const alias of model.aliases) add(alias);
  }
  add(current);
  return choices;
}

export default function XaiCredentialsCard({ token }: { token: string | null }) {
  const [credentials, setCredentials] = useState<XaiCredentialsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<XaiModelChoice[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [form, setForm] = useState({ apiKey: "", model: DEFAULT_MODEL, isActive: true });

  async function loadModels(apiKey?: string) {
    if (!token) return;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const result = await listXaiModels(token, { apiKey: apiKey?.trim() || undefined });
      setModels(result.models);
    } catch (err) {
      setModels([]);
      setModelsError(err instanceof ApiError ? err.message : "Could not load xAI models.");
    } finally {
      setModelsLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getXaiCredentials(token)
      .then((result) => {
        if (!cancelled) setCredentials(result.credentials);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load xAI settings.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function openForm() {
    setForm({
      apiKey: "",
      model: credentials?.model || DEFAULT_MODEL,
      isActive: credentials?.isActive ?? true,
    });
    setSaveError(null);
    setTestMessage(null);
    setModelsError(null);
    setFormOpen(true);
    if (credentials?.hasApiKey) void loadModels();
  }

  function onKeyBlur() {
    const typed = form.apiKey.trim();
    if (typed) void loadModels(typed);
    else if (credentials?.hasApiKey) void loadModels();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (!credentials && !form.apiKey.trim()) {
      setSaveError("An API key is required the first time.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { credentials: saved } = await saveXaiCredentials(token, {
        apiKey: form.apiKey.trim() || undefined,
        model: form.model.trim() || DEFAULT_MODEL,
        isActive: form.isActive,
      });
      setCredentials(saved);
      setFormOpen(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save xAI settings.");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    if (!token) return;
    setTesting(true);
    setTestMessage(null);
    setSaveError(null);
    try {
      const result = await testXaiCredentials(token, {
        apiKey: form.apiKey.trim() || undefined,
        model: form.model.trim() || credentials?.model || DEFAULT_MODEL,
      });
      setTestMessage(result.message || "Key works.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "xAI rejected the key.");
    } finally {
      setTesting(false);
    }
  }

  async function onDelete() {
    if (!token || !window.confirm("Remove the xAI API key?")) return;
    setSaving(true);
    try {
      await deleteXaiCredentials(token);
      setCredentials(null);
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove xAI settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500 shadow-sm">
        Loading xAI settings…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-100 p-2 text-violet-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-dark">xAI</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Summarizes transcribed calls and drafts a follow-up task. The key stays on the server.
            </p>
          </div>
        </div>
        {!formOpen ? (
          <button
            type="button"
            onClick={openForm}
            className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
          >
            {credentials ? "Edit" : "Add key"}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {!formOpen && credentials ? (
        <div className="flex items-center justify-between px-6 py-4 text-sm">
          <div>
            <p className="font-medium text-brand-dark">{credentials.model}</p>
            <p className="text-neutral-500">
              {credentials.hasApiKey ? "Key set" : "Not set"}
              {credentials.isActive ? "" : " · Inactive"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onDelete()}
            disabled={saving}
            className="text-sm text-red-600 hover:underline disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      ) : null}
      {!formOpen && !credentials ? (
        <p className="px-6 py-4 text-sm text-neutral-500">Not set</p>
      ) : null}
      {formOpen ? (
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4 px-6 py-5">
          {saveError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          ) : null}
          {testMessage ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {testMessage}
            </div>
          ) : null}
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">API key</span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={credentials?.hasApiKey ? "Leave blank to keep the current key" : "xai-…"}
                autoComplete="off"
                onBlur={onKeyBlur}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey((open) => !open)}
                className="rounded-md border border-neutral-300 p-2 text-neutral-500"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Model</span>
            <select
              value={form.model}
              onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
              disabled={modelsLoading && modelChoices(models, form.model).length === 0}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              {modelChoices(models, form.model).map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              {modelsLoading
                ? "Loading models from xAI…"
                : modelsError
                  ? modelsError
                  : models.length
                    ? "Chat models available to this key, including aliases."
                    : "Enter an API key to load the models on this account."}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            />
            Active
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={testing}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-60"
            >
              {testing ? "Testing…" : "Test key"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-neutral-500"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
