"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import DialPad from "./DialPad";
import { useSoftphone } from "./SoftphoneProvider";

function elapsed(startedAt: number | null): string {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default function ActiveCallBar() {
  const phone = useSoftphone();
  const [now, setNow] = useState(() => Date.now());
  const [keypad, setKeypad] = useState(false);
  const visible = phone.phase !== "idle";

  useEffect(() => {
    if (phone.phase !== "in-progress") return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [phone.phase]);

  if (!visible) return null;

  const status =
    phone.phase === "connecting"
      ? "Connecting"
      : phone.phase === "ringing"
        ? "Ringing"
        : phone.phase === "in-progress"
          ? elapsed(phone.startedAt)
          : phone.phase === "ended"
            ? "Call ended"
            : "Call failed";

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-[var(--staff-border)] bg-[var(--staff-ink)] p-3 text-[var(--staff-surface)] shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{phone.displayName || "Call"}</p>
          <p className="text-xs opacity-80">{phone.phase === "in-progress" ? elapsed(phone.startedAt) : status}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => phone.mute()}
            disabled={phone.phase === "ended" || phone.phase === "error"}
            className="rounded-full p-2 hover:bg-white/10 disabled:opacity-40"
            aria-label={phone.muted ? "Unmute" : "Mute"}
          >
            {phone.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setKeypad((open) => !open)}
            disabled={phone.phase === "ended" || phone.phase === "error"}
            className="rounded-full px-2 py-1 text-xs font-medium hover:bg-white/10 disabled:opacity-40"
          >
            Keypad
          </button>
          <button
            type="button"
            onClick={phone.hangup}
            className="rounded-full bg-red-600 p-2 hover:bg-red-500"
            aria-label="Hang up"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </div>
      {phone.conversationId &&
      (phone.phase === "in-progress" || phone.phase === "ended") ? (
        <Link
          href={`/dashboard/inboxes?c=${phone.conversationId}`}
          className="mt-2 inline-block text-xs font-medium underline opacity-80"
        >
          Open conversation
        </Link>
      ) : null}
      {phone.error ? <p className="mt-2 text-xs text-red-200">{phone.error}</p> : null}
      {keypad && phone.phase !== "ended" && phone.phase !== "error" ? (
        <div className="mt-3">
          <DialPad tone="dark" onPress={(key) => phone.sendDigits(key)} />
        </div>
      ) : null}
      <span className="sr-only">{now}</span>
    </div>
  );
}
