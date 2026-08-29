"use client";

import { Loader2 } from "lucide-react";
import {
  VoiceContactGroup,
  VoiceCustomerGroup,
  VoiceCallRow,
  VoiceTimelineLine,
  compactVoicePreview,
  formatDuration,
  formatRelativeTime,
} from "./conversationUtils";
import { VoiceActivityTimeline } from "./VoiceActivityTimeline";

type VoiceCustomerPanelProps = {
  group: VoiceCustomerGroup;
  selectedContactKey: string | null;
  selectedVoiceId: string | null;
  shownVoice: VoiceCallRow | null;
  timeline: VoiceTimelineLine[];
  loadingVoiceDetail: boolean;
  onBack: () => void;
  onSelectContact: (contact: VoiceContactGroup) => void;
  onClearContact: () => void;
  onSelectCall: (id: string) => void;
};

export default function VoiceCustomerPanel({
  group,
  selectedContactKey,
  selectedVoiceId,
  shownVoice,
  timeline,
  loadingVoiceDetail,
  onBack,
  onSelectContact,
  onClearContact,
  onSelectCall,
}: VoiceCustomerPanelProps) {
  const selectedContact =
    group.contacts.find((c) => c.key === selectedContactKey) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_1fr]">
        <div
          className={`max-h-[480px] overflow-y-auto border-[var(--staff-border)] md:border-r ${
            selectedContactKey ? "hidden md:block" : "block"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--staff-border)] px-3 py-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-[var(--staff-surface)] md:hidden"
            >
              Back
            </button>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-brand-dark">
                {group.displayName}
              </h3>
              <p className="truncate text-[11px] text-neutral-500">
                {group.contacts.length}{" "}
                {group.unknown
                  ? group.contacts.length === 1
                    ? "number"
                    : "numbers"
                  : group.contacts.length === 1
                    ? "contact"
                    : "contacts"}
              </p>
            </div>
          </div>

          {group.contacts.length === 0 ? (
            <p className="p-3 text-xs text-neutral-500">No calls yet.</p>
          ) : (
            <ul>
              {group.contacts.map((contact) => {
                const active = selectedContactKey === contact.key;
                const latest = contact.calls[0];
                return (
                  <li key={contact.key}>
                    <button
                      type="button"
                      onClick={() => onSelectContact(contact)}
                      className={`w-full border-b border-[var(--staff-border)] px-3 py-2 text-left ${
                        active
                          ? "border-l-2 border-l-brand-orange bg-orange-50"
                          : "hover:bg-[var(--staff-surface)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-brand-dark">
                          {contact.displayName}
                        </span>
                        {contact.status ? (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              contact.status === "open"
                                ? "bg-green-50 text-green-700"
                                : "bg-neutral-100 text-neutral-500"
                            }`}
                          >
                            {contact.status}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-[11px] text-neutral-500">
                        {latest
                          ? compactVoicePreview(
                              latest.communication?.transcript ||
                                latest.transcript ||
                                "",
                              "voice",
                              latest.direction,
                            )
                          : "—"}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-neutral-400">
                        <span className="truncate">
                          {contact.phone || "—"}
                        </span>
                        {contact.ourNumber ? (
                          <>
                            <span>·</span>
                            <span className="truncate">{contact.ourNumber}</span>
                          </>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        {latest ? formatRelativeTime(latest.createdAt) : ""}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div
          className={`min-h-[280px] flex-col bg-[var(--staff-surface)] ${
            selectedContactKey ? "flex" : "hidden md:flex"
          }`}
        >
          <div className="space-y-2 border-b border-[var(--staff-border)] px-3 py-2">
            <div className="flex items-center gap-2">
              {selectedContactKey ? (
                <button
                  type="button"
                  onClick={onClearContact}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-white md:hidden"
                >
                  Back
                </button>
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-dark">
                  {shownVoice
                    ? shownVoice.displayName
                    : selectedContact
                      ? selectedContact.displayName
                      : "Select a call"}
                </p>
                {shownVoice ? (
                  <p className="text-[11px] text-neutral-500">
                    {new Date(shownVoice.createdAt).toLocaleString()}
                    {shownVoice.durationSeconds != null
                      ? ` · ${formatDuration(shownVoice.durationSeconds)}`
                      : ""}
                  </p>
                ) : null}
              </div>
            </div>
            {shownVoice?.recordingUrl ? (
              <audio
                controls
                src={shownVoice.recordingUrl}
                className="w-full"
              />
            ) : null}
          </div>

          {selectedContact && selectedContact.calls.length > 1 ? (
            <div className="flex gap-1 overflow-x-auto border-b border-[var(--staff-border)] px-3 py-2">
              {selectedContact.calls.map((call) => {
                const active = selectedVoiceId === call.id;
                return (
                  <button
                    key={call.id}
                    type="button"
                    onClick={() => onSelectCall(call.id)}
                    className={`shrink-0 rounded-md border px-2 py-1 text-[11px] ${
                      active
                        ? "border-brand-orange bg-orange-50 text-brand-dark"
                        : "border-[var(--staff-border)] text-neutral-500 hover:bg-[var(--staff-surface)]"
                    }`}
                  >
                    {formatRelativeTime(call.createdAt) || "Call"}
                    {call.durationSeconds != null
                      ? ` · ${formatDuration(call.durationSeconds)}`
                      : ""}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto p-4">
            {loadingVoiceDetail && !shownVoice ? (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : !shownVoice ? (
              <p className="text-xs text-neutral-500">
                Pick a contact to open that call.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-neutral-500">
                  {shownVoice.phone || "Unknown caller"}
                </p>
                <VoiceActivityTimeline lines={timeline} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
