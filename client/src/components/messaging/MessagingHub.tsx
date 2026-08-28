"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { formatCustomerName } from "@/lib/formatName";
import { useAuthStore } from "@/store/useAuthStore";
import CreatePanel from "./CreatePanel";
import TemplatesPanel from "./TemplatesPanel";
import ThreadsPanel from "./ThreadsPanel";

const MAX_SEND = 200;

type MessagingTab = "templates" | "create" | "threads";

export default function MessagingHub() {
  const token = useAuthStore((s) => s.token);
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get("contactId");
  const initialTab = searchParams.get("tab");

  const [activeTab, setActiveTab] = useState<MessagingTab>(
    initialTab === "threads" || initialTab === "create"
      ? initialTab
      : "templates",
  );

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
  const [useRenewalsFilter, setUseRenewalsFilter] = useState(true);
  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-11

  const [contacts, setContacts] = useState<MessagingContactItem[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(150);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    initialContactId ? new Set([initialContactId]) : new Set(),
  );
  const [selectedContactsById, setSelectedContactsById] = useState<
    Record<string, MessagingContactItem>
  >({});
  const selectedIdsRef = useRef(selectedIds);
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

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
  const selectedContacts = useMemo(
    () =>
      [...selectedIds]
        .map((id) => selectedContactsById[id])
        .filter((c): c is MessagingContactItem => Boolean(c)),
    [selectedIds, selectedContactsById],
  );
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
        // Backfill full contact details for ids selected before this page
        // (e.g. the initial ?contactId=) loaded.
        setSelectedContactsById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const c of res.contacts) {
            if (selectedIdsRef.current.has(c._id) && !next[c._id]) {
              next[c._id] = c;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
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

  async function handleSaveTemplate() {
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

  function toggleContact(contact: MessagingContactItem) {
    const { _id: id } = contact;
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
    setSelectedContactsById((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: contact };
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
    setSelectedContactsById((prev) => {
      const next = { ...prev };
      if (allSelected) {
        for (const id of pageIds) delete next[id];
      } else {
        for (const c of contacts) next[c._id] = c;
      }
      return next;
    });
  }

  function resetCreateFlow() {
    setSelectedIds(new Set());
    setSelectedContactsById({});
    setSelectedTemplateId(null);
    setTemplateName("");
    setBody(
      "Hi {{first_name}}, this is a reminder about your upcoming service renewal on {{renewal_due_date}}. Reply if you'd like to schedule.",
    );
    setMediaUrlsRaw("");
    setError(null);
    setSendResult(null);
    setResetSignal((n) => n + 1);
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

  if (!token) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-neutral-200">
        {(
          [
            ["templates", "Templates"],
            ["threads", "Threads"],
            ["create", "Message Wizard"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
              activeTab === value
                ? "border-brand-orange text-brand-dark"
                : "border-transparent text-neutral-500 hover:text-brand-dark"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "templates" ? (
        <TemplatesPanel
          templates={templates}
          loadingTemplates={loadingTemplates}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={selectTemplate}
          onStartNewTemplate={startNewTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          templateName={templateName}
          onTemplateNameChange={setTemplateName}
          savingTemplate={savingTemplate}
          onSaveTemplate={handleSaveTemplate}
          mergeFields={mergeFields}
          onInsertMergeField={insertMergeField}
          bodyRef={bodyRef}
          body={body}
          onBodyChange={setBody}
          previewText={previewText}
          previewContactLabel={previewContactLabel}
          previewSample={previewSample}
          error={error}
        />
      ) : activeTab === "create" ? (
        <CreatePanel
          key={resetSignal}
          token={token}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          useRenewalsFilter={useRenewalsFilter}
          onToggleRenewalsFilter={(v) => {
            setUseRenewalsFilter(v);
            setPage(1);
          }}
          viewYear={viewYear}
          viewMonth={viewMonth}
          onShiftMonth={shiftMonth}
          contacts={contacts}
          contactsTotal={contactsTotal}
          loadingContacts={loadingContacts}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          selectedIds={selectedIds}
          selectedContacts={selectedContacts}
          onToggleContact={toggleContact}
          onToggleSelectPage={toggleSelectPage}
          onClearSelection={() => {
            setSelectedIds(new Set());
            setSelectedContactsById({});
          }}
          maxSend={MAX_SEND}
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={selectTemplate}
          onStartNewTemplate={startNewTemplate}
          mergeFields={mergeFields}
          onInsertMergeField={insertMergeField}
          bodyRef={bodyRef}
          body={body}
          onBodyChange={setBody}
          mediaUrlsRaw={mediaUrlsRaw}
          onMediaUrlsRawChange={setMediaUrlsRaw}
          accounts={accounts}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          fromOptions={fromOptions}
          effectiveFromNumber={effectiveFromNumber}
          onFromNumberChange={setFromNumber}
          sending={sending}
          confirmOpen={confirmOpen}
          onOpenConfirm={() => setConfirmOpen(true)}
          onCloseConfirm={() => setConfirmOpen(false)}
          onConfirmSend={handleSend}
          onCancelFlow={resetCreateFlow}
          previewText={previewText}
          previewContactLabel={previewContactLabel}
          previewSample={previewSample}
          error={error}
          sendResult={sendResult}
          onDismissSendResult={() => setSendResult(null)}
        />
      ) : (
        <ThreadsPanel token={token} accounts={accounts} />
      )}
    </div>
  );
}
