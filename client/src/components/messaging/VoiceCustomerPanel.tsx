"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  VoiceContactGroup,
  VoiceCustomerGroup,
  VoiceCallRow,
  compactVoicePreview,
  dateGroupKey,
  dateGroupLabel,
  formatDuration,
  formatRelativeTime,
  ts,
  voiceTimelineLines,
} from "./conversationUtils";
import { VoiceActivityTimeline } from "./VoiceActivityTimeline";

type VoiceCustomerPanelProps = {
  group: VoiceCustomerGroup;
  selectedContactKey: string | null;
  selectedVoiceId: string | null;
  shownVoices: VoiceCallRow[];
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
  shownVoices,
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
          <div className="flex items-center gap-2 border-b border-[var(--staff-border)] px-3 py-2">
            {selectedContactKey ? (
              <button
                type="button"
                onClick={onClearContact}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-[var(--staff-surface)] md:hidden"
              >
                Back
              </button>
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-brand-dark">
                {selectedContact
                  ? selectedContact.displayName
                  : "Select a contact"}
              </p>
            </div>
          </div>

          <VoiceHistoryPane
            pinKey={`${selectedContactKey ?? ""}:${shownVoices.length}`}
            loading={loadingVoiceDetail && !selectedContact}
          >
            {loadingVoiceDetail && !selectedContact ? (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : !selectedContact ? (
              <p className="text-xs text-neutral-500">
                Pick a contact to open that call.
              </p>
            ) : (
              <VoiceCallHistory
                calls={selectedContact.calls}
                shownVoices={shownVoices}
                selectedVoiceId={selectedVoiceId}
                onSelectCall={onSelectCall}
              />
            )}
          </VoiceHistoryPane>
        </div>
      </div>
    </div>
  );
}


function VoiceHistoryPane({
  pinKey,
  loading,
  children,
}: {
  pinKey: string | null;
  loading: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || loading) return;
    el.scrollTop = el.scrollHeight;
  }, [pinKey, loading]);
  return (
    <div ref={ref} className="flex-1 overflow-y-auto p-3">
      {children}
    </div>
  );
}

function VoiceCallHistory({
  calls,
  shownVoices,
  selectedVoiceId,
  onSelectCall,
}: {
  calls: VoiceCallRow[];
  shownVoices: VoiceCallRow[];
  selectedVoiceId: string | null;
  onSelectCall: (id: string) => void;
}) {
  const overlay = new Map(shownVoices.map((row) => [row.id, row]));
  const history = [...calls]
    .sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
    .map((call) => overlay.get(call.id) ?? call);

  return (
    <div className="space-y-3">
      {history.map((call, index) => {
        const key = dateGroupKey(call.createdAt);
        const prevKey =
          index > 0 ? dateGroupKey(history[index - 1].createdAt) : "";
        const duration = formatDuration(call.durationSeconds);
        const lines = voiceTimelineLines(call.communication, call.transcript);
        const active = selectedVoiceId === call.id;
        return (
          <Fragment key={call.id}>
            {key && key !== prevKey ? (
              <div className="sticky top-0 z-10 bg-[var(--staff-surface)] py-1 text-center text-[11px] font-medium text-neutral-500">
                {dateGroupLabel(call.createdAt)}
              </div>
            ) : null}
            <div
              className={`space-y-2 rounded-lg border px-3 py-2 ${
                active
                  ? "border-brand-orange"
                  : "border-[var(--staff-border)]"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectCall(call.id)}
                className="flex w-full items-baseline justify-between gap-2 text-left"
              >
                <span className="text-[13px] font-medium text-brand-dark">
                  {call.direction === "outbound" ? "Outbound call" : "Inbound call"}
                  {duration ? ` · ${duration}` : ""}
                </span>
                <span className="text-[10px] text-neutral-400">
                  {formatRelativeTime(call.createdAt)}
                </span>
              </button>
              {call.recordingUrl ? (
                <audio controls src={call.recordingUrl} className="w-full" />
              ) : null}
              <VoiceActivityTimeline lines={lines} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
