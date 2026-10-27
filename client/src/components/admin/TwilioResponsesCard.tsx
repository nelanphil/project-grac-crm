"use client";

import { FormEvent, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import {
  ApiError,
  getTwilioResponseSettings,
  saveTwilioResponseSettings,
} from "@/lib/api";

const MISSED_CALL_TEXT_MAX = 1600;

export default function TwilioResponsesCard({
  token,
}: {
  token: string | null;
}) {
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const trimmed = text.trim();
  const dirty = text !== savedText;
  const tooLong = trimmed.length > MISSED_CALL_TEXT_MAX;
  const empty = trimmed.length === 0;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const settings = await getTwilioResponseSettings(token!);
        if (!cancelled) {
          setText(settings.missedCallText);
          setSavedText(settings.missedCallText);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load Twilio responses.",
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

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || empty || tooLong) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const settings = await saveTwilioResponseSettings(token, trimmed);
      setText(settings.missedCallText);
      setSavedText(settings.missedCallText);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Failed to save the missed-call message.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500 shadow-sm">
        Loading Twilio responses…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-sm text-red-700 shadow-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-orange-100 p-2 text-brand-orange">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-dark">
              Missed-call text
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Sent when an inbound call is missed and the line can text back.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-4 px-6 py-5">
        {saveError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Missed-call message saved.
          </div>
        )}

        <label className="block">
          <span className="text-xs font-medium text-neutral-600">Message</span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaveSuccess(false);
              setSaveError(null);
            }}
            rows={6}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark"
          />
        </label>
        <p
          className={`text-xs ${tooLong || empty ? "text-red-600" : "text-neutral-500"}`}
        >
          {trimmed.length} / {MISSED_CALL_TEXT_MAX}
          {empty ? " — Message is required." : ""}
          {tooLong ? " — Message must be 1600 characters or fewer." : ""}
        </p>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !dirty || empty || tooLong}
            className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
