"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Phone, X } from "lucide-react";
import DialPad from "@/components/voice/DialPad";
import {
  ApiError,
  DirectoryContact,
  InboxChannels,
  createDirectoryContact,
  getCustomers,
  searchDirectoryContacts,
} from "@/lib/api";
import { formatCustomerName } from "@/lib/formatName";
import { useSoftphone } from "@/components/voice/SoftphoneProvider";

type NewCallDialogProps = {
  token: string;
  channels: InboxChannels | null;
  onClose: () => void;
  onStarted: (conversationId: string) => void;
};

function dialablePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.trim().startsWith("+") && digits.length >= 7) return `+${digits}`;
  return null;
}

function formatDial(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

function duplicateMatches(err: unknown): DirectoryContact[] {
  if (!(err instanceof ApiError) || err.status !== 409) return [];
  const payload = err.payload;
  if (!payload || typeof payload !== "object" || !("matches" in payload)) return [];
  const matches = (payload as { matches?: unknown }).matches;
  return Array.isArray(matches) ? (matches as DirectoryContact[]) : [];
}

export default function NewCallDialog({
  token,
  channels,
  onClose,
  onStarted,
}: NewCallDialogProps) {
  const softphone = useSoftphone();
  const lines = useMemo(
    () =>
      (channels?.twilioAccounts ?? []).flatMap((account) =>
        account.numbers
          .filter((number) => number.voice && account.browserCalling)
          .map((number) => ({
            key: `${account.id}|${number.phoneNumber}`,
            accountId: account.id,
            phoneNumber: number.phoneNumber,
            label: `${account.friendlyName} · ${number.label || formatDial(number.phoneNumber)}`,
          })),
      ),
    [channels],
  );
  const [fromKey, setFromKey] = useState(lines[0]?.key ?? "");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DirectoryContact[]>([]);
  const [creating, setCreating] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [customers, setCustomers] = useState<{ _id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DirectoryContact[]>([]);
  const [keypad, setKeypad] = useState(false);

  const typedNumber = dialablePhone(query);
  const selected = lines.find((line) => line.key === fromKey) ?? lines[0];
  const numberAlreadySaved =
    typedNumber != null &&
    matches.some((match) => dialablePhone(match.phone) === typedNumber);

  useEffect(() => {
    const handle = setTimeout(() => {
      const text = query.trim();
      if (text.length < 2) {
        setMatches([]);
        return;
      }
      searchDirectoryContacts(token, text)
        .then((result) => setMatches(result.contacts))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, token]);

  useEffect(() => {
    const text = customerQuery.trim();
    if (text.length < 2 || customerId) return;
    const handle = setTimeout(() => {
      getCustomers(token, { search: text, pageSize: 25 })
        .then((result) =>
          setCustomers(
            result.customers.map((customer) => ({
              _id: customer._id,
              name:
                customer.accountName?.trim() ||
                formatCustomerName(customer.first, customer.last) ||
                "Customer",
            })),
          ),
        )
        .catch(() => setCustomers([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [customerQuery, customerId, token]);

  async function place(input: {
    contactId?: string;
    phone?: string;
    displayName: string;
  }) {
    if (!selected) {
      setError("Enable browser calling on a voice line before placing a call.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await softphone.startCall({
        ...input,
        twilioAccountId: selected.accountId,
        fromNumber: selected.phoneNumber,
      });
      onStarted(started.conversationId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Call failed");
    } finally {
      setBusy(false);
    }
  }

  async function createAndCall(event: FormEvent) {
    event.preventDefault();
    if (!typedNumber) return;
    setBusy(true);
    setError(null);
    setDuplicates([]);
    try {
      const created = await createDirectoryContact(token, {
        first,
        last,
        phone: typedNumber,
        email,
        customerId: customerId || undefined,
      });
      await place({
        contactId: created.contact._id,
        displayName:
          formatCustomerName(created.contact.first, created.contact.last) ||
          formatDial(typedNumber),
      });
    } catch (err) {
      const existing = duplicateMatches(err);
      if (existing.length > 0) {
        setDuplicates(existing);
        setError("That number is already a contact.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not create the contact");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-black/30 p-4">
      <div className="mt-8 w-full max-w-md rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--staff-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--staff-ink)]">New call</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--staff-muted)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-3">
          {lines.length === 0 ? (
            <p className="text-xs text-[var(--staff-muted)]">
              Enable browser calling on a Twilio account with a voice line. A public API URL is required.
            </p>
          ) : (
            <label className="block text-xs text-[var(--staff-muted)]">
              From
              <select
                value={selected?.key ?? ""}
                onChange={(event) => setFromKey(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)]"
              >
                {lines.map((line) => (
                  <option key={line.key} value={line.key}>
                    {line.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCreating(false);
                setDuplicates([]);
              }}
              placeholder="Search contacts or type a phone number"
              className="min-w-0 flex-1 rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1.5 text-sm text-[var(--staff-ink)] outline-none"
            />
            <button
              type="button"
              onClick={() => setKeypad((open) => !open)}
              className={`shrink-0 rounded-md px-2 py-1.5 text-xs font-medium ${
                keypad
                  ? "bg-[#2f6fed] text-white"
                  : "text-[#2f6fed] hover:bg-[var(--staff-cream)]"
              }`}
            >
              Keypad
            </button>
          </div>
          {keypad ? (
            <div className="space-y-2">
              <DialPad
                onPress={(key) => {
                  setQuery((current) => `${current}${key}`);
                  setCreating(false);
                  setDuplicates([]);
                }}
                onBackspace={() => setQuery((current) => current.slice(0, -1))}
              />
              {typedNumber ? (
                <button
                  type="button"
                  disabled={busy || lines.length === 0}
                  onClick={() =>
                    void place({ phone: typedNumber, displayName: formatDial(typedNumber) })
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
                >
                  <Phone className="h-4 w-4" />
                  Call {formatDial(typedNumber)}
                </button>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {typedNumber && !numberAlreadySaved ? (
              <li>
                <button
                  type="button"
                  disabled={busy || lines.length === 0}
                  onClick={() =>
                    void place({ phone: typedNumber, displayName: formatDial(typedNumber) })
                  }
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--staff-cream)] disabled:opacity-50"
                >
                  <Phone className="h-3.5 w-3.5 text-[#2f6fed]" />
                  <span>Call {formatDial(typedNumber)}</span>
                  <span className="ml-auto text-[11px] text-[var(--staff-muted)]">Without saving</span>
                </button>
              </li>
            ) : null}
            {matches.map((match) => (
              <li key={match._id}>
                <button
                  type="button"
                  disabled={busy || lines.length === 0}
                  onClick={() =>
                    void place({
                      contactId: match._id,
                      displayName:
                        formatCustomerName(match.first, match.last) || formatDial(match.phone),
                    })
                  }
                  className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--staff-cream)] disabled:opacity-50"
                >
                  <span className="text-[var(--staff-ink)]">
                    {formatCustomerName(match.first, match.last) || "Unnamed contact"}
                    <span className="ml-2 text-xs text-[var(--staff-muted)]">
                      {formatDial(match.phone)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--staff-muted)]">
                    {match.customerName || "No customer"}
                  </span>
                </button>
              </li>
            ))}
            {duplicates.map((match) => (
              <li key={`dup-${match._id}`}>
                <button
                  type="button"
                  disabled={busy || lines.length === 0}
                  onClick={() =>
                    void place({
                      contactId: match._id,
                      displayName:
                        formatCustomerName(match.first, match.last) || formatDial(match.phone),
                    })
                  }
                  className="flex w-full items-baseline justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--staff-cream)]"
                >
                  <span>Use {formatCustomerName(match.first, match.last) || formatDial(match.phone)}</span>
                  <span className="text-[11px] text-[var(--staff-muted)]">Existing</span>
                </button>
              </li>
            ))}
          </ul>
          {typedNumber && !numberAlreadySaved && !creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-xs font-medium text-[#2f6fed]"
            >
              Create contact for {formatDial(typedNumber)}
            </button>
          ) : null}
          {creating && typedNumber ? (
            <form onSubmit={(event) => void createAndCall(event)} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={first}
                  onChange={(event) => setFirst(event.target.value)}
                  placeholder="First name"
                  className="rounded-md border border-[var(--staff-border)] px-2 py-1.5 text-sm"
                />
                <input
                  value={last}
                  onChange={(event) => setLast(event.target.value)}
                  placeholder="Last name"
                  className="rounded-md border border-[var(--staff-border)] px-2 py-1.5 text-sm"
                />
              </div>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email (optional)"
                className="w-full rounded-md border border-[var(--staff-border)] px-2 py-1.5 text-sm"
              />
              <input
                value={customerLabel || customerQuery}
                onChange={(event) => {
                  setCustomerId("");
                  setCustomerLabel("");
                  setCustomerQuery(event.target.value);
                }}
                placeholder="Attach to customer (optional)"
                className="w-full rounded-md border border-[var(--staff-border)] px-2 py-1.5 text-sm"
              />
              {!customerId && customers.length > 0 ? (
                <ul className="max-h-28 overflow-y-auto rounded-md border border-[var(--staff-border)]">
                  {customers.map((customer) => (
                    <li key={customer._id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerId(customer._id);
                          setCustomerLabel(customer.name);
                          setCustomers([]);
                        }}
                        className="block w-full px-2 py-1.5 text-left text-sm hover:bg-[var(--staff-cream)]"
                      >
                        {customer.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="submit"
                disabled={busy || (!first.trim() && !last.trim())}
                className="rounded-md bg-[#2f6fed] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save and call"}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
