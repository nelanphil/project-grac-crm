"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare } from "lucide-react";
import {
  ApiError,
  textTechnicianSchedule,
  type ScheduleTextResult,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const MISSING_PHONE =
  "Add a mobile number for this technician before texting their schedule. Add it on the technician’s hours and territory page.";

export function TextScheduleButton({
  userId,
  date,
  variant,
  disabled,
  className,
}: {
  userId: string;
  date: string;
  variant: "label" | "icon";
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelClass =
    "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-brand-orange hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40";
  const iconClass =
    "shrink-0 rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      <button
        type="button"
        disabled={disabled || !userId}
        aria-label="Text Schedule"
        title="Text schedule"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen(true);
        }}
        className={className ?? (variant === "icon" ? iconClass : labelClass)}
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        {variant === "label" ? "Text Schedule" : null}
      </button>
      {open ? (
        <TextScheduleDialog
          userId={userId}
          date={date}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function TextScheduleDialog({
  userId,
  date,
  onClose,
}: {
  userId: string;
  date: string;
  onClose: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const titleId = useId();
  const [preview, setPreview] = useState<ScheduleTextResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "sending" | "sent">(
    "loading",
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    textTechnicianSchedule(token, { userId, date })
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load this schedule.",
        );
        setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId, date]);

  async function send() {
    if (!token || phase === "sending") return;
    setPhase("sending");
    setError(null);
    try {
      const result = await textTechnicianSchedule(token, {
        userId,
        date,
        send: true,
      });
      setPreview(result);
      setPhase("sent");
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "Failed to text this schedule.",
      );
      setPhase("ready");
    }
  }

  const missingPhone = Boolean(preview && !preview.phoneLast4);
  const canSend = phase === "ready" && Boolean(preview?.phoneLast4);
  const title = preview?.technicianName
    ? `Text schedule to ${preview.technicianName}?`
    : "Text schedule";

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => {
        if (phase !== "sending") onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
      >
        <h3 id={titleId} className="text-lg font-semibold text-brand-dark">
          {phase === "sent" ? "Schedule text sent" : title}
        </h3>
        {phase === "loading" ? (
          <p className="mt-3 text-sm text-neutral-500">Loading schedule…</p>
        ) : null}
        {preview?.phoneLast4 ? (
          <p className="mt-1 text-sm text-neutral-500">
            Texting ••••{preview.phoneLast4}
          </p>
        ) : null}
        {missingPhone ? (
          <p className="mt-3 text-sm text-red-700">{MISSING_PHONE}</p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-red-700">{error}</p>
        ) : null}
        {preview ? (
          <pre className="mt-4 whitespace-pre-wrap rounded-md bg-neutral-50 p-3 font-sans text-sm text-neutral-800">
            {preview.body}
          </pre>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "sending"}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            {phase === "sent" ? "Close" : "Cancel"}
          </button>
          {phase === "sent" ? null : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "sending" ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
