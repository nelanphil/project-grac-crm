"use client";

import { Phone, PhoneOff, X } from "lucide-react";

type IncomingCallModalProps = {
  callerName: string;
  callerNumber: string;
  lineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
};

function phoneParts(phone: string): { digits: string; formatted: string } {
  const digits = phone.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) {
    return {
      digits: ten,
      formatted: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`,
    };
  }
  const raw = phone.trim();
  return { digits: raw || "Unknown number", formatted: "" };
}

export default function IncomingCallModal({
  callerName,
  callerNumber,
  lineLabel,
  onAccept,
  onDecline,
  onDismiss,
}: IncomingCallModalProps) {
  const phone = phoneParts(callerNumber);
  const name = callerName.trim() || "Unknown";
  const initial = (name[0] || phone.digits[0] || "?").toUpperCase();

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 px-4 pt-[10vh]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="incoming-call-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--staff-border)] bg-[var(--staff-ink)] text-[var(--staff-surface)] shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-current/10 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-current/10">
              <Phone className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="truncate text-sm font-semibold tracking-wide">
              {lineLabel || "Line"}
            </span>
          </div>
          <p id="incoming-call-title" className="shrink-0 text-sm opacity-80">
            Incoming call
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full p-1 opacity-80 hover:bg-current/10"
            aria-label="Close incoming call"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-pink-500 text-3xl font-semibold text-white">
            {initial}
          </div>
          <p className="mt-5 text-lg font-semibold">{name}</p>
          <p className="mt-2 text-sm opacity-75">{phone.digits}</p>
          {phone.formatted ? (
            <p className="text-sm opacity-75">{phone.formatted}</p>
          ) : null}

          <div className="mt-8 grid w-full grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onDecline}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500"
            >
              <PhoneOff className="h-4 w-4" aria-hidden />
              Decline
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-500"
            >
              <Phone className="h-4 w-4" aria-hidden />
              Accept
            </button>
          </div>
          <p className="mt-4 max-w-xs text-xs leading-5 opacity-60">
            Declining a call still allows others in the shared inbox to pick up
          </p>
        </div>
      </div>
    </div>
  );
}
