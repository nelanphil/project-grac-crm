"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  EmailSendAccountItem,
  EmailSendResponse,
  MergeFieldItem,
  MessageTemplateItem,
  MessageTemplateType,
  MessagingContactItem,
  MessagingSendResponse,
  TwilioAccountItem,
  createMessageTemplate,
  deleteMessageTemplate,
  getEmailPaymentLinkAvailability,
  getEmailSendAccounts,
  getMessageTemplates,
  getMessagingMergeFields,
  getTwilioAccounts,
  previewEmailMessage,
  previewMessagingMessage,
  searchEmailContacts,
  searchMessagingContacts,
  sendEmailMessages,
  sendMessagingMessages,
  updateMessageTemplate,
} from "@/lib/api";
import {
  DEFAULT_EMAIL_CHROME,
  isEmailBodyEmpty,
  mergeEmailChrome,
} from "@/lib/emailChrome";
import { formatCustomerName } from "@/lib/formatName";
import { useAuthStore } from "@/store/useAuthStore";
import CreatePanel from "./CreatePanel";
import EmailCreatePanel from "./EmailCreatePanel";
import { EmailBodyEditorHandle } from "./EmailBodyEditor";
import SentEmailsPanel from "./SentEmailsPanel";
import TemplatesPanel from "./TemplatesPanel";
import ThreadsPanel from "./ThreadsPanel";

const MAX_SEND = 200;

const DEFAULT_SMS_BODY =
  "Hi {{first_name}}, this is a reminder about your upcoming service renewal on {{renewal_due_date}}. Reply if you'd like to schedule.";
const DEFAULT_EMAIL_SUBJECT = "Service renewal reminder";
const DEFAULT_EMAIL_BODY = DEFAULT_SMS_BODY;

type MessagingTab =
  | "templates"
  | "create"
  | "email"
  | "threads"
  | "sent-emails";

function templateTypeOf(template: MessageTemplateItem): MessageTemplateType {
  return template.templateType === "email" ? "email" : "sms";
}

export default function MessagingHub() {
  const token = useAuthStore((s) => s.token);
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get("contactId");
  const initialTab = searchParams.get("tab");

  const [activeTab, setActiveTab] = useState<MessagingTab>(
    initialTab === "threads" ||
      initialTab === "create" ||
      initialTab === "email" ||
      initialTab === "sent-emails"
      ? initialTab
      : "templates",
  );

  const [templates, setTemplates] = useState<MessageTemplateItem[]>([]);
  const [mergeFields, setMergeFields] = useState<MergeFieldItem[]>([]);
  const [accounts, setAccounts] = useState<TwilioAccountItem[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<EmailSendAccountItem[]>(
    [],
  );

  const [templateEditorType, setTemplateEditorType] =
    useState<MessageTemplateType>("sms");

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateName, setTemplateName] = useState("");
  const [body, setBody] = useState(DEFAULT_SMS_BODY);

  const [selectedEmailTemplateId, setSelectedEmailTemplateId] = useState<
    string | null
  >(null);
  const [emailTemplateName, setEmailTemplateName] = useState("");
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT);
  const [emailBody, setEmailBody] = useState(DEFAULT_EMAIL_BODY);
  const [emailChrome, setEmailChrome] = useState(DEFAULT_EMAIL_CHROME);

  const [previewText, setPreviewText] = useState("");
  const [previewSample, setPreviewSample] = useState(true);
  const [previewContactLabel, setPreviewContactLabel] = useState<
    string | undefined
  >();

  const [emailPreviewSubject, setEmailPreviewSubject] = useState("");
  const [emailPreviewHtml, setEmailPreviewHtml] = useState("");
  const [emailPreviewSample, setEmailPreviewSample] = useState(true);
  const [emailPreviewTo, setEmailPreviewTo] = useState<string | undefined>();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [useRenewalsFilter, setUseRenewalsFilter] = useState(true);
  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

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

  const [emailSearch, setEmailSearch] = useState("");
  const [emailDebouncedSearch, setEmailDebouncedSearch] = useState("");
  const [emailUseRenewalsFilter, setEmailUseRenewalsFilter] = useState(true);
  const [emailViewYear, setEmailViewYear] = useState(now.getFullYear());
  const [emailViewMonth, setEmailViewMonth] = useState(now.getMonth());
  const [emailContacts, setEmailContacts] = useState<MessagingContactItem[]>(
    [],
  );
  const [emailContactsTotal, setEmailContactsTotal] = useState(0);
  const [emailPage, setEmailPage] = useState(1);
  const [emailPageSize, setEmailPageSize] = useState(150);
  const [emailSelectedIds, setEmailSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [emailSelectedContactsById, setEmailSelectedContactsById] = useState<
    Record<string, MessagingContactItem>
  >({});
  const emailSelectedIdsRef = useRef(emailSelectedIds);

  const [resetSignal, setResetSignal] = useState(0);
  const [emailResetSignal, setEmailResetSignal] = useState(0);
  const [showSelectAllPrompt, setShowSelectAllPrompt] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [emailShowSelectAllPrompt, setEmailShowSelectAllPrompt] =
    useState(false);
  const [emailSelectingAll, setEmailSelectingAll] = useState(false);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    emailSelectedIdsRef.current = emailSelectedIds;
  }, [emailSelectedIds]);

  const [accountId, setAccountId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [mediaUrlsRaw, setMediaUrlsRaw] = useState("");
  const [emailAccountId, setEmailAccountId] = useState("");
  const [emailFromNickname, setEmailFromNickname] = useState("");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [emailEmailsPerSecond, setEmailEmailsPerSecond] = useState(2);

  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingEmailContacts, setLoadingEmailContacts] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<MessagingSendResponse | null>(
    null,
  );
  const [emailSendResult, setEmailSendResult] =
    useState<EmailSendResponse | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const emailBodyRef = useRef<EmailBodyEditorHandle>(null);
  const emailSubjectRef = useRef<HTMLInputElement>(null);

  const selectedAccount = accounts.find((a) => a._id === accountId);
  const fromOptions = selectedAccount?.phoneNumbers ?? [];
  const selectedContacts = useMemo(
    () =>
      [...selectedIds]
        .map((id) => selectedContactsById[id])
        .filter((c): c is MessagingContactItem => Boolean(c)),
    [selectedIds, selectedContactsById],
  );
  const selectedEmailContacts = useMemo(
    () =>
      [...emailSelectedIds]
        .map((id) => emailSelectedContactsById[id])
        .filter((c): c is MessagingContactItem => Boolean(c)),
    [emailSelectedIds, emailSelectedContactsById],
  );
  const effectiveFromNumber = fromOptions.includes(fromNumber)
    ? fromNumber
    : (fromOptions[0] ?? "");

  const selectedEmailAccount = emailAccounts.find(
    (a) => a._id === emailAccountId,
  );
  const emailFromDisplayName =
    emailFromNickname.trim() || selectedEmailAccount?.fromName || "";
  const emailFromLabel = selectedEmailAccount
    ? `${emailFromDisplayName} <${selectedEmailAccount.fromEmail}>`
    : undefined;

  const smsTemplates = useMemo(
    () => templates.filter((t) => templateTypeOf(t) === "sms"),
    [templates],
  );
  const emailTemplates = useMemo(
    () => templates.filter((t) => templateTypeOf(t) === "email"),
    [templates],
  );
  const editorTemplates =
    templateEditorType === "email" ? emailTemplates : smsTemplates;
  const smsMergeFields = useMemo(
    () =>
      mergeFields.filter(
        (f) => !f.templateTypes || f.templateTypes.includes("sms"),
      ),
    [mergeFields],
  );
  const emailMergeFields = useMemo(
    () =>
      mergeFields.filter(
        (f) => !f.templateTypes || f.templateTypes.includes("email"),
      ),
    [mergeFields],
  );
  const editorMergeFields =
    templateEditorType === "email" ? emailMergeFields : smsMergeFields;

  const loadEmailContacts =
    activeTab === "email" ||
    (activeTab === "templates" && templateEditorType === "email");
  const emailUsesPaymentLink = /\{\{\s*payment_link\s*\}\}/.test(
    `${emailSubject}\n${emailBody}`,
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => setEmailDebouncedSearch(emailSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [emailSearch]);

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
      getEmailSendAccounts(token),
    ])
      .then(([tplRes, fieldsRes, acctRes, emailAcctRes]) => {
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
        setEmailAccounts(emailAcctRes.accounts);
        if (emailAcctRes.accounts.length > 0) {
          setEmailAccountId((prev) => prev || emailAcctRes.accounts[0]._id);
          setEmailFromNickname((prev) => prev || emailAcctRes.accounts[0].fromName);
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

  useEffect(() => {
    if (!token || !loadEmailContacts) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadingEmailContacts(true);
    });

    searchEmailContacts(token, {
      search: emailDebouncedSearch || undefined,
      year: emailUseRenewalsFilter ? emailViewYear : undefined,
      month: emailUseRenewalsFilter ? emailViewMonth + 1 : undefined,
      page: emailPage,
      pageSize: emailPageSize,
    })
      .then((res) => {
        if (cancelled) return;
        setEmailContacts(res.contacts);
        setEmailContactsTotal(res.total);
        setEmailSelectedContactsById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const c of res.contacts) {
            if (emailSelectedIdsRef.current.has(c._id) && !next[c._id]) {
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
          err instanceof ApiError
            ? err.message
            : "Failed to search email contacts.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingEmailContacts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    token,
    loadEmailContacts,
    emailDebouncedSearch,
    emailUseRenewalsFilter,
    emailViewYear,
    emailViewMonth,
    emailPage,
    emailPageSize,
  ]);

  useEffect(() => {
    if (!token || !emailUsesPaymentLink) return;
    const customerIds = [
      ...new Set([
        ...emailContacts.map((c) => c.customerRef),
        ...Object.values(emailSelectedContactsById).map((c) => c.customerRef),
      ]),
    ].filter(Boolean);
    if (customerIds.length === 0) return;

    let cancelled = false;
    getEmailPaymentLinkAvailability(token, customerIds)
      .then((res) => {
        if (cancelled) return;
        const map = new Map(
          res.available.map((row) => [row.customerId, row.hasPayableInvoice]),
        );
        setEmailContacts((prev) => {
          let changed = false;
          const next = prev.map((c) => {
            const value = map.get(c.customerRef);
            if (value === undefined || c.hasPayableInvoice === value) return c;
            changed = true;
            return { ...c, hasPayableInvoice: value };
          });
          return changed ? next : prev;
        });
        setEmailSelectedContactsById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, contact] of Object.entries(prev)) {
            const value = map.get(contact.customerRef);
            if (value === undefined || contact.hasPayableInvoice === value) {
              continue;
            }
            next[id] = { ...contact, hasPayableInvoice: value };
            changed = true;
          }
          return changed ? next : prev;
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    token,
    emailUsesPaymentLink,
    emailContacts,
    emailSelectedContactsById,
  ]);

  useEffect(() => {
    if (!token) return;
    if (
      activeTab !== "create" &&
      !(activeTab === "templates" && templateEditorType === "sms")
    ) {
      return;
    }
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
    activeTab,
    templateEditorType,
    body,
    selectedIds,
    contacts,
    useRenewalsFilter,
    viewYear,
    viewMonth,
  ]);

  useEffect(() => {
    if (!token) return;
    if (
      activeTab !== "email" &&
      !(activeTab === "templates" && templateEditorType === "email")
    ) {
      return;
    }
    let cancelled = false;
    const previewContactId =
      emailSelectedIds.size === 1 ? [...emailSelectedIds][0] : undefined;

    const timer = setTimeout(() => {
      previewEmailMessage(token, {
        subject: emailSubject,
        body: emailBody,
        emailChrome: mergeEmailChrome(emailChrome),
        contactId: previewContactId,
        renewalYear: emailUseRenewalsFilter ? emailViewYear : undefined,
        renewalMonth: emailUseRenewalsFilter ? emailViewMonth + 1 : undefined,
      })
        .then((res) => {
          if (cancelled) return;
          setEmailPreviewSubject(res.renderedSubject);
          setEmailPreviewHtml(res.html);
          setEmailPreviewSample(res.sample);
          if (previewContactId) {
            const c = emailContacts.find((x) => x._id === previewContactId);
            setEmailPreviewTo(
              c?.email || "jordan.lee@example.com",
            );
          } else {
            setEmailPreviewTo("jordan.lee@example.com");
          }
        })
        .catch(() => {
          if (cancelled) return;
          setEmailPreviewSubject(emailSubject);
          setEmailPreviewHtml("");
          setEmailPreviewSample(true);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    token,
    activeTab,
    templateEditorType,
    emailSubject,
    emailBody,
    emailChrome,
    emailSelectedIds,
    emailContacts,
    emailUseRenewalsFilter,
    emailViewYear,
    emailViewMonth,
  ]);

  function selectSmsTemplate(template: MessageTemplateItem) {
    setSelectedTemplateId(template._id);
    setTemplateName(template.name);
    setBody(template.body ?? "");
  }

  function startNewSmsTemplate() {
    setSelectedTemplateId(null);
    setTemplateName("");
    setBody(DEFAULT_SMS_BODY);
  }

  function selectEmailTemplate(template: MessageTemplateItem) {
    setSelectedEmailTemplateId(template._id);
    setEmailTemplateName(template.name);
    setEmailSubject(template.subject || DEFAULT_EMAIL_SUBJECT);
    setEmailBody(template.body ?? "");
    setEmailChrome(mergeEmailChrome(template.emailChrome));
  }

  function startNewEmailTemplate() {
    setSelectedEmailTemplateId(null);
    setEmailTemplateName("");
    setEmailSubject(DEFAULT_EMAIL_SUBJECT);
    setEmailBody(DEFAULT_EMAIL_BODY);
    setEmailChrome(DEFAULT_EMAIL_CHROME);
  }

  function insertAtCursor(
    el: HTMLTextAreaElement | HTMLInputElement | null,
    current: string,
    setValue: (next: string) => void,
    tokenText: string,
  ) {
    if (!el) {
      setValue(current + tokenText);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + tokenText + current.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + tokenText.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function insertSmsMergeField(key: string) {
    insertAtCursor(bodyRef.current, body, setBody, `{{${key}}}`);
  }

  function insertEmailMergeField(key: string) {
    const tokenText = `{{${key}}}`;
    const subjectEl = emailSubjectRef.current;
    if (subjectEl && document.activeElement === subjectEl) {
      insertAtCursor(subjectEl, emailSubject, setEmailSubject, tokenText);
      return;
    }
    emailBodyRef.current?.insertText(tokenText);
  }

  async function persistTemplate(type: MessageTemplateType) {
    if (!token) return;
    const isEmail = type === "email";
    const name = (isEmail ? emailTemplateName : templateName).trim();
    if (!name) {
      setError("Template name is required.");
      return;
    }
    setSavingTemplate(true);
    setError(null);
    try {
      const selectedId = isEmail
        ? selectedEmailTemplateId
        : selectedTemplateId;
      if (selectedId) {
        const { template } = await updateMessageTemplate(token, selectedId, {
          name,
          body: isEmail ? emailBody : body,
          subject: isEmail ? emailSubject : "",
          templateType: type,
          emailChrome: isEmail ? mergeEmailChrome(emailChrome) : undefined,
        });
        setTemplates((prev) =>
          prev.map((t) => (t._id === template._id ? template : t)),
        );
      } else {
        const { template } = await createMessageTemplate(token, {
          name,
          body: isEmail ? emailBody : body,
          subject: isEmail ? emailSubject : undefined,
          templateType: type,
          emailChrome: isEmail ? mergeEmailChrome(emailChrome) : undefined,
        });
        setTemplates((prev) =>
          [...prev, template].sort((a, b) => a.name.localeCompare(b.name)),
        );
        if (isEmail) setSelectedEmailTemplateId(template._id);
        else setSelectedTemplateId(template._id);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save template.",
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  function handleSaveTemplate() {
    void persistTemplate(templateEditorType);
  }

  function handleSaveEmailTemplate() {
    void persistTemplate("email");
  }

  async function handleDeleteTemplate(id: string) {
    if (!token) return;
    if (!window.confirm("Delete this message template?")) return;
    setError(null);
    try {
      await deleteMessageTemplate(token, id);
      setTemplates((prev) => prev.filter((t) => t._id !== id));
      if (selectedTemplateId === id) startNewSmsTemplate();
      if (selectedEmailTemplateId === id) startNewEmailTemplate();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete template.",
      );
    }
  }

  function toggleContact(
    contact: MessagingContactItem,
    ids: Set<string>,
    setIds: (next: Set<string>) => void,
    byId: Record<string, MessagingContactItem>,
    setById: (next: Record<string, MessagingContactItem>) => void,
  ) {
    const { _id: id } = contact;
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= MAX_SEND) {
        setError(`You can select at most ${MAX_SEND} contacts per send.`);
        return;
      }
      next.add(id);
    }
    setIds(next);
    if (byId[id]) {
      const copy = { ...byId };
      delete copy[id];
      setById(copy);
    } else {
      setById({ ...byId, [id]: contact });
    }
  }

  function toggleSelectPage(
    pageContacts: MessagingContactItem[],
    ids: Set<string>,
    setIds: (next: Set<string>) => void,
    byId: Record<string, MessagingContactItem>,
    setById: (next: Record<string, MessagingContactItem>) => void,
  ): { selected: boolean; nextSize: number } {
    const pageIds = pageContacts.map((c) => c._id);
    const allSelected = pageIds.every((id) => ids.has(id));
    const next = new Set(ids);
    const nextById = { ...byId };
    if (allSelected) {
      for (const id of pageIds) {
        next.delete(id);
        delete nextById[id];
      }
    } else {
      for (const c of pageContacts) {
        if (next.size >= MAX_SEND) break;
        next.add(c._id);
        nextById[c._id] = c;
      }
    }
    setIds(next);
    setById(nextById);
    return { selected: !allSelected, nextSize: next.size };
  }

  function resetCreateFlow() {
    setSelectedIds(new Set());
    setSelectedContactsById({});
    setShowSelectAllPrompt(false);
    setSelectedTemplateId(null);
    setTemplateName("");
    setBody(DEFAULT_SMS_BODY);
    setMediaUrlsRaw("");
    setError(null);
    setSendResult(null);
    setResetSignal((n) => n + 1);
  }

  function resetEmailCreateFlow() {
    setEmailSelectedIds(new Set());
    setEmailSelectedContactsById({});
    setEmailShowSelectAllPrompt(false);
    setSelectedEmailTemplateId(null);
    setEmailTemplateName("");
    setEmailSubject(DEFAULT_EMAIL_SUBJECT);
    setEmailBody(DEFAULT_EMAIL_BODY);
    setEmailChrome(DEFAULT_EMAIL_CHROME);
    setEmailFromNickname(selectedEmailAccount?.fromName ?? "");
    setEmailReplyTo("");
    setEmailEmailsPerSecond(2);
    setError(null);
    setEmailSendResult(null);
    setEmailResetSignal((n) => n + 1);
  }

  function shiftMonth(
    delta: number,
    month: number,
    year: number,
    setMonth: (m: number) => void,
    setYear: (y: number) => void,
    setPageNum: (p: number) => void,
  ) {
    setPageNum(1);
    let next = month + delta;
    let nextYear = year;
    if (next < 0) {
      next = 11;
      nextYear -= 1;
    } else if (next > 11) {
      next = 0;
      nextYear += 1;
    }
    setYear(nextYear);
    setMonth(next);
  }

  async function selectAllMatching(channel: "sms" | "email") {
    if (!token) return;
    const isEmail = channel === "email";
    const setLoading = isEmail ? setEmailSelectingAll : setSelectingAll;
    const setPrompt = isEmail
      ? setEmailShowSelectAllPrompt
      : setShowSelectAllPrompt;
    setLoading(true);
    setError(null);
    try {
      const res = isEmail
        ? await searchEmailContacts(token, {
            search: emailDebouncedSearch || undefined,
            year: emailUseRenewalsFilter ? emailViewYear : undefined,
            month: emailUseRenewalsFilter ? emailViewMonth + 1 : undefined,
            page: 1,
            pageSize: MAX_SEND,
          })
        : await searchMessagingContacts(token, {
            search: debouncedSearch || undefined,
            year: useRenewalsFilter ? viewYear : undefined,
            month: useRenewalsFilter ? viewMonth + 1 : undefined,
            page: 1,
            pageSize: MAX_SEND,
          });
      const ids = isEmail ? emailSelectedIds : selectedIds;
      const byId = isEmail ? emailSelectedContactsById : selectedContactsById;
      const next = new Set(ids);
      const nextById = { ...byId };
      for (const c of res.contacts) {
        if (next.size >= MAX_SEND) break;
        next.add(c._id);
        nextById[c._id] = c;
      }
      if (isEmail) {
        setEmailSelectedIds(next);
        setEmailSelectedContactsById(nextById);
      } else {
        setSelectedIds(next);
        setSelectedContactsById(nextById);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to select matching contacts.",
      );
    } finally {
      setLoading(false);
      setPrompt(false);
    }
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

  async function handleEmailSend() {
    if (!token) return;
    if (emailSelectedIds.size === 0) {
      setError("Select at least one contact.");
      return;
    }
    if (!emailSubject.trim() || isEmailBodyEmpty(emailBody)) {
      setError("Email subject and body are required.");
      return;
    }
    if (!emailAccountId) {
      setError("Select an email account to send from.");
      return;
    }

    setEmailSending(true);
    setError(null);
    setEmailSendResult(null);
    try {
      const result = await sendEmailMessages(token, {
        contactIds: [...emailSelectedIds],
        subject: emailSubject,
        body: emailBody,
        emailChrome: mergeEmailChrome(emailChrome),
        templateId: selectedEmailTemplateId ?? undefined,
        emailAccountId,
        fromName: emailFromDisplayName || undefined,
        replyTo: emailReplyTo.trim() || undefined,
        emailsPerSecond: emailEmailsPerSecond,
        renewalYear: emailUseRenewalsFilter ? emailViewYear : undefined,
        renewalMonth: emailUseRenewalsFilter ? emailViewMonth + 1 : undefined,
      });
      setEmailSendResult(result);
      setEmailConfirmOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to send emails.",
      );
    } finally {
      setEmailSending(false);
    }
  }

  if (!token) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-neutral-200">
        {(
          [
            ["templates", "Templates"],
            ["threads", "Threads"],
            ["create", "Message Wizard"],
            ["email", "Email Wizard"],
            ["sent-emails", "Sent Emails"],
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
          templates={editorTemplates}
          loadingTemplates={loadingTemplates}
          selectedTemplateId={
            templateEditorType === "email"
              ? selectedEmailTemplateId
              : selectedTemplateId
          }
          onSelectTemplate={
            templateEditorType === "email"
              ? selectEmailTemplate
              : selectSmsTemplate
          }
          onStartNewTemplate={
            templateEditorType === "email"
              ? startNewEmailTemplate
              : startNewSmsTemplate
          }
          onDeleteTemplate={handleDeleteTemplate}
          templateType={templateEditorType}
          onTemplateTypeChange={setTemplateEditorType}
          templateName={
            templateEditorType === "email" ? emailTemplateName : templateName
          }
          onTemplateNameChange={
            templateEditorType === "email"
              ? setEmailTemplateName
              : setTemplateName
          }
          savingTemplate={savingTemplate}
          onSaveTemplate={handleSaveTemplate}
          mergeFields={editorMergeFields}
          onInsertMergeField={
            templateEditorType === "email"
              ? insertEmailMergeField
              : insertSmsMergeField
          }
          bodyRef={bodyRef}
          emailEditorRef={emailBodyRef}
          subjectRef={emailSubjectRef}
          subject={emailSubject}
          onSubjectChange={setEmailSubject}
          body={templateEditorType === "email" ? emailBody : body}
          onBodyChange={
            templateEditorType === "email" ? setEmailBody : setBody
          }
          emailChrome={emailChrome}
          onEmailChromeChange={setEmailChrome}
          previewText={previewText}
          previewSubject={emailPreviewSubject}
          previewHtml={emailPreviewHtml}
          previewFromLabel={emailFromLabel}
          previewToLabel={emailPreviewTo}
          previewContactLabel={previewContactLabel}
          previewSample={
            templateEditorType === "email" ? emailPreviewSample : previewSample
          }
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
            setShowSelectAllPrompt(false);
          }}
          useRenewalsFilter={useRenewalsFilter}
          onToggleRenewalsFilter={(v) => {
            setUseRenewalsFilter(v);
            setPage(1);
            setShowSelectAllPrompt(false);
          }}
          viewYear={viewYear}
          viewMonth={viewMonth}
          onShiftMonth={(delta) => {
            setShowSelectAllPrompt(false);
            shiftMonth(
              delta,
              viewMonth,
              viewYear,
              setViewMonth,
              setViewYear,
              setPage,
            );
          }}
          contacts={contacts}
          contactsTotal={contactsTotal}
          loadingContacts={loadingContacts}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
            setShowSelectAllPrompt(false);
          }}
          selectedIds={selectedIds}
          selectedContacts={selectedContacts}
          onToggleContact={(c) =>
            toggleContact(
              c,
              selectedIds,
              setSelectedIds,
              selectedContactsById,
              setSelectedContactsById,
            )
          }
          onToggleSelectPage={() => {
            const result = toggleSelectPage(
              contacts,
              selectedIds,
              setSelectedIds,
              selectedContactsById,
              setSelectedContactsById,
            );
            setShowSelectAllPrompt(
              result.selected &&
                contactsTotal > contacts.length &&
                result.nextSize < MAX_SEND,
            );
          }}
          onClearSelection={() => {
            setSelectedIds(new Set());
            setSelectedContactsById({});
            setShowSelectAllPrompt(false);
          }}
          showSelectAllPrompt={showSelectAllPrompt}
          selectingAll={selectingAll}
          onSelectAll={() => {
            void selectAllMatching("sms");
          }}
          maxSend={MAX_SEND}
          templates={smsTemplates}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={selectSmsTemplate}
          onStartNewTemplate={startNewSmsTemplate}
          mergeFields={smsMergeFields}
          onInsertMergeField={insertSmsMergeField}
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
      ) : activeTab === "email" ? (
        <EmailCreatePanel
          key={emailResetSignal}
          search={emailSearch}
          onSearchChange={(v) => {
            setEmailSearch(v);
            setEmailPage(1);
            setEmailShowSelectAllPrompt(false);
          }}
          useRenewalsFilter={emailUseRenewalsFilter}
          onToggleRenewalsFilter={(v) => {
            setEmailUseRenewalsFilter(v);
            setEmailPage(1);
            setEmailShowSelectAllPrompt(false);
          }}
          viewYear={emailViewYear}
          viewMonth={emailViewMonth}
          onShiftMonth={(delta) => {
            setEmailShowSelectAllPrompt(false);
            shiftMonth(
              delta,
              emailViewMonth,
              emailViewYear,
              setEmailViewMonth,
              setEmailViewYear,
              setEmailPage,
            );
          }}
          contacts={emailContacts}
          contactsTotal={emailContactsTotal}
          loadingContacts={loadingEmailContacts}
          page={emailPage}
          pageSize={emailPageSize}
          onPageChange={setEmailPage}
          onPageSizeChange={(size) => {
            setEmailPageSize(size);
            setEmailPage(1);
            setEmailShowSelectAllPrompt(false);
          }}
          selectedIds={emailSelectedIds}
          selectedContacts={selectedEmailContacts}
          onToggleContact={(c) =>
            toggleContact(
              c,
              emailSelectedIds,
              setEmailSelectedIds,
              emailSelectedContactsById,
              setEmailSelectedContactsById,
            )
          }
          onToggleSelectPage={() => {
            const result = toggleSelectPage(
              emailContacts,
              emailSelectedIds,
              setEmailSelectedIds,
              emailSelectedContactsById,
              setEmailSelectedContactsById,
            );
            setEmailShowSelectAllPrompt(
              result.selected &&
                emailContactsTotal > emailContacts.length &&
                result.nextSize < MAX_SEND,
            );
          }}
          onClearSelection={() => {
            setEmailSelectedIds(new Set());
            setEmailSelectedContactsById({});
            setEmailShowSelectAllPrompt(false);
          }}
          showSelectAllPrompt={emailShowSelectAllPrompt}
          selectingAll={emailSelectingAll}
          onSelectAll={() => {
            void selectAllMatching("email");
          }}
          maxSend={MAX_SEND}
          templates={emailTemplates}
          loadingTemplates={loadingTemplates}
          selectedTemplateId={selectedEmailTemplateId}
          onSelectTemplate={selectEmailTemplate}
          onStartNewTemplate={startNewEmailTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          templateName={emailTemplateName}
          onTemplateNameChange={setEmailTemplateName}
          savingTemplate={savingTemplate}
          onSaveTemplate={handleSaveEmailTemplate}
          mergeFields={emailMergeFields}
          onInsertMergeField={insertEmailMergeField}
          bodyRef={emailBodyRef}
          subjectRef={emailSubjectRef}
          subject={emailSubject}
          onSubjectChange={setEmailSubject}
          body={emailBody}
          onBodyChange={setEmailBody}
          emailChrome={emailChrome}
          onEmailChromeChange={setEmailChrome}
          accounts={emailAccounts}
          accountId={emailAccountId}
          onAccountIdChange={(value) => {
            setEmailAccountId(value);
            const next = emailAccounts.find((a) => a._id === value);
            setEmailFromNickname(next?.fromName ?? "");
          }}
          fromNickname={emailFromNickname}
          onFromNicknameChange={setEmailFromNickname}
          replyTo={emailReplyTo}
          onReplyToChange={setEmailReplyTo}
          emailsPerSecond={emailEmailsPerSecond}
          onEmailsPerSecondChange={setEmailEmailsPerSecond}
          sending={emailSending}
          confirmOpen={emailConfirmOpen}
          onOpenConfirm={() => setEmailConfirmOpen(true)}
          onCloseConfirm={() => setEmailConfirmOpen(false)}
          onConfirmSend={handleEmailSend}
          onCancelFlow={resetEmailCreateFlow}
          previewSubject={emailPreviewSubject}
          previewHtml={emailPreviewHtml}
          previewFromLabel={emailFromLabel}
          previewToLabel={emailPreviewTo}
          previewSample={emailPreviewSample}
          showPaymentLinkColumn={emailUsesPaymentLink}
          error={error}
          sendResult={emailSendResult}
          onDismissSendResult={() => setEmailSendResult(null)}
        />
      ) : activeTab === "sent-emails" ? (
        <SentEmailsPanel token={token} />
      ) : (
        <ThreadsPanel token={token} accounts={accounts} />
      )}
    </div>
  );
}
