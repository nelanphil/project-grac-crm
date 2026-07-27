"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  MergeFieldItem,
  MessageTemplateItem,
  MessagingContactItem,
  MessagingSendResponse,
  TwilioAccountItem,
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplates,
  getMessagingMergeFields,
  getTwilioAccounts,
  previewMessagingMessage,
  searchMessagingContacts,
  sendMessagingMessages,
  updateMessageTemplate,
} from "@/lib/api";
import { formatCustomerName, toProperCase } from "@/lib/formatName";
import PhonePreview from "./PhonePreview";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MAX_SEND = 100;

function formatPhone(phone: string | undefined | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatRenewalDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MessagingHub() {
  const token = useAuthStore((s) => s.token);
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get("contactId");

  const [templates, setTemplates] = useState<MessageTemplateItem[]>([]);
  const [mergeFields, setMergeFields] = useState<MergeFieldItem[]>([]);
  const [accounts, setAccounts] = useState<TwilioAccountItem[]>([]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateName, setTemplateName] = useState("");
  const [body, setBody] = useState(
    "Hi {{first_name}}, this is a reminder about your upcoming service renewal on {{renewal_due_date}}. Reply if you'd like to schedule.",
  );

  const [previewText, setPreviewText] = useState("");
  const [previewSample, setPreviewSample] = useState(true);
  const [previewContactLabel, setPreviewContactLabel] = useState<
    string | undefined
  >();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [useRenewalsFilter, setUseRenewalsFilter] = useState(false);
  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-11

  const [contacts, setContacts] = useState<MessagingContactItem[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    initialContactId ? new Set([initialContactId]) : new Set(),
  );

  const [accountId, setAccountId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [mediaUrlsRaw, setMediaUrlsRaw] = useState("");

  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<MessagingSendResponse | null>(
    null,
  );

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const selectedAccount = accounts.find((a) => a._id === accountId);
  const fromOptions = selectedAccount?.phoneNumbers ?? [];
  const effectiveFromNumber = fromOptions.includes(fromNumber)
    ? fromNumber
    : (fromOptions[0] ?? "");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load templates, merge fields, Twilio accounts
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadingTemplates(true);
      setError(null);
    });

    Promise.all([
      getMessageTemplates(token),
      getMessagingMergeFields(token),
      getTwilioAccounts(token),
    ])
      .then(([tplRes, fieldsRes, acctRes]) => {
        if (cancelled) return;
        setTemplates(tplRes.templates);
        setMergeFields(fieldsRes.fields);
        const active = acctRes.accounts.filter((a) => a.isActive);
        setAccounts(active);
        if (active.length > 0) {
          setAccountId((prev) => prev || active[0]._id);
          const nums = active[0].phoneNumbers ?? [];
          if (nums.length > 0) {
            setFromNumber((prev) => prev || nums[0]);
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load messaging data.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Load contacts
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadingContacts(true);
    });

    searchMessagingContacts(token, {
      search: debouncedSearch || undefined,
      year: useRenewalsFilter ? viewYear : undefined,
      month: useRenewalsFilter ? viewMonth + 1 : undefined,
      page,
      pageSize,
    })
      .then((res) => {
        if (cancelled) return;
        setContacts(res.contacts);
        setContactsTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to search contacts.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingContacts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    token,
    debouncedSearch,
    useRenewalsFilter,
    viewYear,
    viewMonth,
    page,
    pageSize,
  ]);

  // Preview rendering
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const previewContactId =
      selectedIds.size === 1 ? [...selectedIds][0] : undefined;

    const timer = setTimeout(() => {
      previewMessagingMessage(token, {
        body,
        contactId: previewContactId,
        renewalYear: useRenewalsFilter ? viewYear : undefined,
        renewalMonth: useRenewalsFilter ? viewMonth + 1 : undefined,
      })
        .then((res) => {
          if (cancelled) return;
          setPreviewText(res.rendered);
          setPreviewSample(res.sample);
          if (previewContactId) {
            const c = contacts.find((x) => x._id === previewContactId);
            setPreviewContactLabel(
              c ? formatCustomerName(c.first, c.last) || "Contact" : "Contact",
            );
          } else {
            setPreviewContactLabel("Jordan Lee");
          }
        })
        .catch(() => {
          if (cancelled) return;
          setPreviewText(body);
          setPreviewSample(true);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    token,
    body,
    selectedIds,
    contacts,
    useRenewalsFilter,
    viewYear,
    viewMonth,
  ]);

  function selectTemplate(template: MessageTemplateItem) {
    setSelectedTemplateId(template._id);
    setTemplateName(template.name);
    setBody(template.body ?? "");
  }

  function startNewTemplate() {
    setSelectedTemplateId(null);
    setTemplateName("");
    setBody(
      "Hi {{first_name}}, this is a reminder about your upcoming service renewal on {{renewal_due_date}}. Reply if you'd like to schedule.",
    );
  }

  function insertMergeField(key: string) {
    const tokenText = `{{${key}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((prev) => prev + tokenText);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + tokenText + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + tokenText.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSaveTemplate(e?: FormEvent) {
    e?.preventDefault();
    if (!token) return;
    if (!templateName.trim()) {
      setError("Template name is required.");
      return;
    }
    setSavingTemplate(true);
    setError(null);
    try {
      if (selectedTemplateId) {
        const { template } = await updateMessageTemplate(
          token,
          selectedTemplateId,
          { name: templateName.trim(), body },
        );
        setTemplates((prev) =>
          prev.map((t) => (t._id === template._id ? template : t)),
        );
      } else {
        const { template } = await createMessageTemplate(token, {
          name: templateName.trim(),
          body,
        });
        setTemplates((prev) =>
          [...prev, template].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setSelectedTemplateId(template._id);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save template.",
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    if (!token) return;
    if (!window.confirm("Delete this message template?")) return;
    setError(null);
    try {
      await deleteMessageTemplate(token, id);
      setTemplates((prev) => prev.filter((t) => t._id !== id));
      if (selectedTemplateId === id) startNewTemplate();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete template.",
      );
    }
  }

  function toggleContact(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= MAX_SEND) {
          setError(`You can select at most ${MAX_SEND} contacts per send.`);
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectPage() {
    const pageIds = contacts.map((c) => c._id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) {
          if (next.size >= MAX_SEND) break;
          next.add(id);
        }
      }
      return next;
    });
  }

  function shiftMonth(delta: number) {
    setPage(1);
    setViewMonth((m) => {
      let next = m + delta;
      let year = viewYear;
      if (next < 0) {
        next = 11;
        year -= 1;
      } else if (next > 11) {
        next = 0;
        year += 1;
      }
      setViewYear(year);
      return next;
    });
  }

  async function handleSend() {
    if (!token) return;
    if (selectedIds.size === 0) {
      setError("Select at least one contact.");
      return;
    }
    if (!body.trim()) {
      setError("Message body is empty.");
      return;
    }
    if (!accountId || !effectiveFromNumber) {
      setError("Select a Twilio account and from number.");
      return;
    }

    const mediaUrls = mediaUrlsRaw
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);

    setSending(true);
    setError(null);
    setSendResult(null);
    try {
      const result = await sendMessagingMessages(token, {
        contactIds: [...selectedIds],
        body,
        templateId: selectedTemplateId ?? undefined,
        twilioAccountId: accountId,
        fromNumber: effectiveFromNumber,
        mediaUrls: mediaUrls.length ? mediaUrls : undefined,
        renewalYear: useRenewalsFilter ? viewYear : undefined,
        renewalMonth: useRenewalsFilter ? viewMonth + 1 : undefined,
      });
      setSendResult(result);
      setConfirmOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to send messages.",
      );
    } finally {
      setSending(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(contactsTotal / pageSize));
  const pageAllSelected =
    contacts.length > 0 && contacts.every((c) => selectedIds.has(c._id));

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {sendResult ? (
        <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm">
          <p className="font-medium text-brand-dark">
            Send complete — {sendResult.summary.sent} sent,{" "}
            {sendResult.summary.failed} failed
          </p>
          {sendResult.summary.failed > 0 ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-neutral-600">
              {sendResult.results
                .filter((r) => r.status === "failed")
                .map((r) => (
                  <li key={r.contactId}>
                    {r.contactId}: {r.error || "Failed"}
                  </li>
                ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="mt-2 text-xs font-medium text-brand-orange hover:underline"
            onClick={() => setSendResult(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Templates list */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-brand-dark">Templates</h2>
            <button
              type="button"
              onClick={startNewTemplate}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-orange hover:bg-orange-50"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
          {loadingTemplates ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : templates.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No saved templates yet. Compose a message and save it.
            </p>
          ) : (
            <ul className="max-h-[520px] space-y-1 overflow-y-auto">
              {templates.map((t) => (
                <li key={t._id}>
                  <div
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                      selectedTemplateId === t._id
                        ? "bg-orange-50 text-brand-dark"
                        : "hover:bg-neutral-50"
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left text-sm"
                      onClick={() => selectTemplate(t)}
                    >
                      <span className="block truncate font-medium">
                        {t.name}
                      </span>
                      <span className="block truncate text-[11px] text-neutral-400">
                        {t.body || "Empty"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                      title="Delete template"
                      onClick={() => handleDeleteTemplate(t._id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Composer + recipients */}
        <section className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="min-w-[200px] flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-neutral-500">
                  Template name
                </span>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. Renewal reminder"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                />
              </label>
              <button
                type="button"
                onClick={() => handleSaveTemplate()}
                disabled={savingTemplate}
                className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {savingTemplate ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {selectedTemplateId ? "Update" : "Save"} template
              </button>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
              {mergeFields.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  title={field.description}
                  onClick={() => insertMergeField(field.key)}
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-brand-orange hover:text-brand-orange"
                >
                  {`{{${field.key}}}`}
                </button>
              ))}
            </div>

            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={1600}
              className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              placeholder="Write your SMS template…"
            />
            <p className="mt-1 text-right text-[11px] text-neutral-400">
              {body.length}/1600
            </p>
          </div>

          {/* Recipients */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-brand-dark">
                Recipients
              </h2>
              <span className="text-xs text-neutral-500">
                {selectedIds.size} selected
                {selectedIds.size > 0 ? ` · max ${MAX_SEND}` : ""}
              </span>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search contacts by name or phone…"
                className="min-w-[220px] flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              />
              <label className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={useRenewalsFilter}
                  onChange={(e) => {
                    setUseRenewalsFilter(e.target.checked);
                    setPage(1);
                  }}
                />
                Upcoming renewals
              </label>
            </div>

            {useRenewalsFilter ? (
              <div className="mb-3 flex items-center justify-between rounded-lg bg-neutral-50 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="rounded p-1 text-neutral-500 hover:bg-white hover:text-brand-dark"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-brand-dark">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="rounded p-1 text-neutral-500 hover:bg-white hover:text-brand-dark"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectPage}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-brand-dark"
              >
                {pageAllSelected ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                Select page
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-neutral-500 hover:text-brand-dark"
              >
                Clear
              </button>
            </div>

            <div className="max-h-[320px] overflow-auto rounded-lg border border-neutral-100">
              {loadingContacts ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading contacts…
                </div>
              ) : contacts.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-neutral-500">
                  No contacts with valid phone numbers found.
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
                    <tr>
                      <th className="w-8 px-2 py-2" />
                      <th className="px-2 py-2 font-medium">Contact</th>
                      <th className="px-2 py-2 font-medium">Phone</th>
                      <th className="px-2 py-2 font-medium">Customer</th>
                      {useRenewalsFilter ? (
                        <th className="px-2 py-2 font-medium">Renewal</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c) => {
                      const checked = selectedIds.has(c._id);
                      return (
                        <tr
                          key={c._id}
                          className={`border-t border-neutral-100 ${
                            checked ? "bg-orange-50/50" : "hover:bg-neutral-50"
                          }`}
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleContact(c._id)}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-brand-dark">
                              {formatCustomerName(c.first, c.last) || "—"}
                            </div>
                            {c.label ? (
                              <div className="text-[11px] text-neutral-400">
                                {toProperCase(c.label)}
                                {c.isPrimary ? " · Primary" : ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-neutral-700">
                            {formatPhone(c.phone)}
                          </td>
                          <td className="px-2 py-2 text-neutral-600">
                            {formatCustomerName(
                              c.customer.first,
                              c.customer.last,
                            ) || "—"}
                          </td>
                          {useRenewalsFilter ? (
                            <td className="px-2 py-2 whitespace-nowrap text-neutral-600">
                              {formatRenewalDate(c.renewalDueDate)}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
              <span>
                {contactsTotal} contact{contactsTotal === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
                >
                  Prev
                </button>
                <span>
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Send bar */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-500">
                MMS media URLs (optional, one per line — publicly reachable)
              </span>
              <textarea
                value={mediaUrlsRaw}
                onChange={(e) => setMediaUrlsRaw(e.target.value)}
                rows={2}
                placeholder="https://example.com/image.jpg"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[180px] flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-neutral-500">
                  Twilio account
                </span>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                >
                  {accounts.length === 0 ? (
                    <option value="">No active accounts</option>
                  ) : (
                    accounts.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.friendlyName} ({a.accountSid.slice(0, 6)}…)
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="min-w-[160px] flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-neutral-500">
                  From number
                </span>
                <select
                  value={effectiveFromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                >
                  {fromOptions.length === 0 ? (
                    <option value="">No numbers</option>
                  ) : (
                    fromOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                disabled={
                  sending ||
                  selectedIds.size === 0 ||
                  !accountId ||
                  !effectiveFromNumber ||
                  !body.trim()
                }
                onClick={() => setConfirmOpen(true)}
                className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <MessageSquare className="h-4 w-4" />
                Send to {selectedIds.size || 0}
                {mediaUrlsRaw.trim() ? " (MMS)" : ""}
              </button>
            </div>
            {accounts.length === 0 ? (
              <p className="mt-2 text-xs text-amber-700">
                Configure an active Twilio account with phone numbers in Control
                Panel before sending.
              </p>
            ) : null}
          </div>
        </section>

        {/* Phone preview */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-brand-dark">
            Phone preview
          </h2>
          <p className="mb-4 text-xs text-neutral-500">
            {selectedIds.size === 1
              ? "Preview uses the selected contact’s data."
              : "Select a single contact for a live merge preview, or view sample data."}
          </p>
          <PhonePreview
            message={previewText}
            contactLabel={previewContactLabel}
            isSample={previewSample}
          />
        </section>
      </div>

      {/* Confirm dialog */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-dark">
              Confirm bulk send
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              Send this message to <strong>{selectedIds.size}</strong> contact
              {selectedIds.size === 1 ? "" : "s"} from{" "}
              <strong>{effectiveFromNumber}</strong>?
            </p>
            <p className="mt-2 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 whitespace-pre-wrap">
              {previewText || body}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                onClick={() => setConfirmOpen(false)}
                disabled={sending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
                onClick={handleSend}
                disabled={sending}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                Send now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
