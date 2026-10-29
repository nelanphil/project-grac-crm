"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  DEFAULT_RENEWAL_VARIANTS,
  EmailSendAccountItem,
  MergeFieldItem,
  MessageTemplateItem,
  MessageTemplateType,
  MessagingContactItem,
  RenewalPreviewStatus,
  RenewalVariants,
  ScheduledEmailItem,
  ScheduledMessageItem,
  TwilioAccountItem,
  ContractTemplateItem,
  createMessageTemplate,
  deleteMessageTemplate,
  getContractTemplates,
  getCustomerContacts,
  getEmailPaymentLinkAvailability,
  getEmailSendAccounts,
  getInvoice,
  getMessageTemplates,
  getMessagingMergeFields,
  getTwilioAccounts,
  previewEmailMessage,
  previewMessagingMessage,
  searchEmailContacts,
  searchMessagingContacts,
  scheduleEmailMessages,
  scheduleMessagingMessages,
  updateMessageTemplate,
} from "@/lib/api";
import {
  invoiceEmailBodyHtml,
  invoiceEmailSubject,
  isInvoicePayable,
  messagingContactFromInvoice,
  pickInvoiceEmailContact,
} from "@/lib/invoiceEmailHtml";
import {
  DEFAULT_EMAIL_CHROME,
  isEmailBodyEmpty,
  mergeEmailChrome,
} from "@/lib/emailChrome";
import { formatCustomerName } from "@/lib/formatName";
import {
  formatLocalDate,
  isEmailScheduleTimeValid,
  localDateTimeToIso,
} from "@/lib/schedule";
import { useAuthStore } from "@/store/useAuthStore";
import MobileTabBar from "@/components/ui/MobileTabBar";
import CreatePanel from "./CreatePanel";
import EmailCreatePanel from "./EmailCreatePanel";
import { EmailBodyEditorHandle } from "./EmailBodyEditor";
import ScheduledEmailsPanel from "./ScheduledEmailsPanel";
import ScheduledMessagesPanel from "./ScheduledMessagesPanel";
import ContactFormSubmissionsPanel from "./ContactFormSubmissionsPanel";
import CommunicationsLogPanel from "./CommunicationsLogPanel";
import SentEmailsPanel from "./SentEmailsPanel";
import SentMessagesPanel from "./SentMessagesPanel";
import TemplatesPanel from "./TemplatesPanel";

const MAX_SEND = 200;

const DEFAULT_SMS_BODY =
  "Hi {{first_name}}, this is a reminder about your upcoming service renewal on {{renewal_due_date}}. Reply if you'd like to schedule.";
const DEFAULT_EMAIL_SUBJECT = "Service renewal reminder";
const DEFAULT_EMAIL_BODY = DEFAULT_SMS_BODY;

type MessagingTab =
  | "templates"
  | "create"
  | "email"
  | "contact-form"
  | "communications-log";

type MessageSubTab = "wizard" | "sent-messages" | "scheduled";

type EmailSubTab = "wizard" | "sent-emails" | "scheduled";

function templateTypeOf(template: MessageTemplateItem): MessageTemplateType {
  return template.templateType === "email" ? "email" : "sms";
}

function renewalVariantsFrom(
  template: MessageTemplateItem,
): RenewalVariants {
  return template.renewalVariants
    ? { ...DEFAULT_RENEWAL_VARIANTS, ...template.renewalVariants }
    : DEFAULT_RENEWAL_VARIANTS;
}

function variantBodyKey(
  tab: RenewalPreviewStatus,
): "expired" | "dueSoon" | "active" | null {
  if (tab === "expired") return "expired";
  if (tab === "due_soon") return "dueSoon";
  if (tab === "active") return "active";
  return null;
}

const SMS_PAYMENT_LINK_FIELD: MergeFieldItem = {
  key: "payment_link",
  label: "Payment link",
  description:
    "Payment link for the selected invoice, or the latest eligible invoice when none is selected. The amount is locked when the message is sent.",
};

/** SMS always offers {{payment_link}}, even if an older API still marks it email-only. */
function smsMergeFieldsFrom(fields: MergeFieldItem[]): MergeFieldItem[] {
  const visible = fields.filter(
    (field) =>
      field.key === "payment_link" ||
      !field.templateTypes ||
      field.templateTypes.includes("sms"),
  );
  if (visible.some((field) => field.key === "payment_link")) return visible;
  return [...visible, SMS_PAYMENT_LINK_FIELD];
}

function messagingTabFromQuery(
  tab: string | null,
  view: string | null,
): MessagingTab {
  if (view === "contact-form" || tab === "contact-form") return "contact-form";
  if (
    tab === "sent-emails" ||
    view === "sent-emails" ||
    tab === "scheduled-emails" ||
    (tab === "email" && view === "scheduled")
  ) {
    return "email";
  }
  if (
    tab === "sent-messages" ||
    view === "sent-messages" ||
    tab === "scheduled-messages" ||
    (tab === "create" && view === "scheduled")
  ) {
    return "create";
  }
  if (
    tab === "templates" ||
    tab === "create" ||
    tab === "email" ||
    tab === "communications-log"
  ) {
    return tab;
  }
  return "contact-form";
}

function messageSubTabFromQuery(
  tab: string | null,
  view: string | null,
): MessageSubTab {
  if (
    tab === "scheduled-messages" ||
    (tab === "create" && view === "scheduled")
  ) {
    return "scheduled";
  }
  if (tab === "sent-messages" || view === "sent-messages") return "sent-messages";
  return "wizard";
}

function emailSubTabFromQuery(
  tab: string | null,
  view: string | null,
  emailId: string,
): EmailSubTab {
  if (
    tab === "scheduled-emails" ||
    (tab === "email" && view === "scheduled")
  ) {
    return "scheduled";
  }
  if (
    tab === "sent-emails" ||
    view === "sent-emails" ||
    (tab === "email" && view === "sent-emails") ||
    Boolean(emailId)
  ) {
    return "sent-emails";
  }
  return "wizard";
}

export default function MessagingHub() {
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get("contactId");
  const initialInvoiceId = searchParams.get("invoiceId");
  const [invoiceAmountCents, setInvoiceAmountCents] = useState<number>();
  const initialTab = searchParams.get("tab");
  const initialView = searchParams.get("view");

  const [activeTab, setActiveTab] = useState<MessagingTab>(
    messagingTabFromQuery(initialTab, initialView),
  );

  const [messageSubTab, setMessageSubTab] = useState<MessageSubTab>(
    messageSubTabFromQuery(initialTab, initialView),
  );
  const [emailSubTab, setEmailSubTab] = useState<EmailSubTab>(
    emailSubTabFromQuery(
      initialTab,
      initialView,
      searchParams.get("emailId") ?? "",
    ),
  );

  const sentEmailId = searchParams.get("emailId") ?? "";
  const [appliedSentEmailId, setAppliedSentEmailId] = useState(sentEmailId);
  if (sentEmailId && sentEmailId !== appliedSentEmailId) {
    setAppliedSentEmailId(sentEmailId);
    setActiveTab("email");
    setEmailSubTab("sent-emails");
  }
  const sentEmailsLink =
    searchParams.get("tab") === "sent-emails" ||
    (searchParams.get("tab") === "email" &&
      searchParams.get("view") === "sent-emails") ||
    searchParams.get("view") === "sent-emails"
      ? searchParams.toString()
      : "";
  const [appliedSentEmailsLink, setAppliedSentEmailsLink] =
    useState(sentEmailsLink);
  if (sentEmailsLink && sentEmailsLink !== appliedSentEmailsLink) {
    setAppliedSentEmailsLink(sentEmailsLink);
    setActiveTab("email");
    setEmailSubTab("sent-emails");
  }
  const messageWizardLink =
    searchParams.get("tab") === "scheduled-messages" ||
    searchParams.get("tab") === "sent-messages" ||
    searchParams.get("view") === "sent-messages" ||
    (searchParams.get("tab") === "create" &&
      searchParams.get("view") === "scheduled")
      ? searchParams.toString()
      : "";
  const [appliedMessageWizardLink, setAppliedMessageWizardLink] =
    useState(messageWizardLink);
  if (messageWizardLink && messageWizardLink !== appliedMessageWizardLink) {
    setAppliedMessageWizardLink(messageWizardLink);
    setActiveTab("create");
    setMessageSubTab(
      messageSubTabFromQuery(
        searchParams.get("tab"),
        searchParams.get("view"),
      ),
    );
  }
  const scheduledEmailsLink =
    searchParams.get("tab") === "scheduled-emails" ||
    (searchParams.get("tab") === "email" &&
      searchParams.get("view") === "scheduled")
      ? searchParams.toString()
      : "";
  const [appliedScheduledEmailsLink, setAppliedScheduledEmailsLink] =
    useState(scheduledEmailsLink);
  if (scheduledEmailsLink && scheduledEmailsLink !== appliedScheduledEmailsLink) {
    setAppliedScheduledEmailsLink(scheduledEmailsLink);
    setActiveTab("email");
    setEmailSubTab("scheduled");
  }
  const legacyInboxLink =
    (initialTab === "threads" || initialTab === "inbox") &&
    initialView !== "contact-form" &&
    initialView !== "sent-emails" &&
    !sentEmailId;
  const contactFormLink =
    initialView === "contact-form" || initialTab === "contact-form"
      ? searchParams.toString()
      : "";
  const [appliedContactFormLink, setAppliedContactFormLink] =
    useState(contactFormLink);
  if (contactFormLink && contactFormLink !== appliedContactFormLink) {
    setAppliedContactFormLink(contactFormLink);
    setActiveTab("contact-form");
  }

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
  const [renewalVariants, setRenewalVariants] = useState<RenewalVariants>(
    DEFAULT_RENEWAL_VARIANTS,
  );
  const [smsVariantTab, setSmsVariantTab] =
    useState<RenewalPreviewStatus>("due_soon");

  const [selectedEmailTemplateId, setSelectedEmailTemplateId] = useState<
    string | null
  >(null);
  const [emailTemplateName, setEmailTemplateName] = useState("");
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT);
  const [emailBody, setEmailBody] = useState(DEFAULT_EMAIL_BODY);
  const [emailChrome, setEmailChrome] = useState(DEFAULT_EMAIL_CHROME);
  const [includePaymentLink, setIncludePaymentLink] = useState(false);
  const [offerContractTemplateId, setOfferContractTemplateId] = useState<
    string | null
  >(null);
  const [offerContractOverrides, setOfferContractOverrides] = useState<
    Record<string, string | null>
  >({});
  const [smsIncludePaymentLink, setSmsIncludePaymentLink] = useState(false);
  const [smsOfferContractTemplateId, setSmsOfferContractTemplateId] = useState<
    string | null
  >(null);
  const [smsOfferContractOverrides, setSmsOfferContractOverrides] = useState<
    Record<string, string | null>
  >({});
  const [contractTemplates, setContractTemplates] = useState<
    ContractTemplateItem[]
  >([]);

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
  const [selectableTotal, setSelectableTotal] = useState(0);
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
  const [emailUseRenewalsFilter, setEmailUseRenewalsFilter] = useState(
    () => !initialInvoiceId,
  );
  const [emailViewYear, setEmailViewYear] = useState(now.getFullYear());
  const [emailViewMonth, setEmailViewMonth] = useState(now.getMonth());
  const [emailContacts, setEmailContacts] = useState<MessagingContactItem[]>(
    [],
  );
  const [emailContactsTotal, setEmailContactsTotal] = useState(0);
  const [emailSelectableTotal, setEmailSelectableTotal] = useState(0);
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
    if (legacyInboxLink) router.replace("/dashboard/inboxes");
  }, [legacyInboxLink, router]);

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
  const [emailScheduleDate, setEmailScheduleDate] = useState(() =>
    formatLocalDate(new Date()),
  );
  const [emailScheduleTime, setEmailScheduleTime] = useState("");
  const [messageScheduleDate, setMessageScheduleDate] = useState(() =>
    formatLocalDate(new Date()),
  );
  const [messageScheduleTime, setMessageScheduleTime] = useState("");

  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingEmailContacts, setLoadingEmailContacts] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageScheduleResult, setMessageScheduleResult] =
    useState<ScheduledMessageItem | null>(null);
  const [emailScheduleResult, setEmailScheduleResult] =
    useState<ScheduledEmailItem | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const emailBodyRef = useRef<EmailBodyEditorHandle>(null);
  const emailSubjectRef = useRef<HTMLInputElement>(null);

  const selectedAccount = accounts.find((a) => a._id === accountId);
  const fromOptions =
    selectedAccount?.phoneNumbers.map((line) => line.phoneNumber) ?? [];
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
    () => smsMergeFieldsFrom(mergeFields),
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
  const emailHasPaymentLinkToken = /\{\{\s*payment_link\s*\}\}/.test(
    `${emailSubject}\n${emailBody}\n${emailChrome.headerHtml}\n${emailChrome.footerHtml}\n${emailChrome.unsubscribeNote}`,
  );
  const emailUsesPaymentLink =
    includePaymentLink || emailHasPaymentLinkToken;
  const smsHasPaymentLinkToken = /\{\{\s*payment_link\s*\}\}/.test(
    [
      body,
      renewalVariants.enabled ? renewalVariants.expired : "",
      renewalVariants.enabled ? renewalVariants.dueSoon : "",
      renewalVariants.enabled ? renewalVariants.active : "",
    ].join("\n"),
  );
  const smsUsesPaymentLink =
    smsIncludePaymentLink || smsHasPaymentLinkToken;

  useEffect(() => {
    if (!token || !initialInvoiceId) return;
    let cancelled = false;

    void (async () => {
      try {
        const { invoice } = await getInvoice(token, initialInvoiceId);
        setInvoiceAmountCents(invoice.amountCents);
        if (cancelled) return;
        if (!invoice.customerRef) {
          setError("This invoice has no customer to email.");
          return;
        }

        const { contacts } = await getCustomerContacts(
          token,
          invoice.customerRef,
        );
        if (cancelled) return;

        const contact = pickInvoiceEmailContact(contacts, initialContactId);
        if (!contact) {
          setError("This customer has no contact with a valid email address.");
          return;
        }

        const selected = messagingContactFromInvoice(contact, invoice);
        setEmailSelectedIds(new Set([contact._id]));
        setEmailSelectedContactsById({ [contact._id]: selected });
        setEmailUseRenewalsFilter(false);
        setEmailSubject(invoiceEmailSubject(invoice));
        setEmailBody(invoiceEmailBodyHtml(invoice));
        setIncludePaymentLink(isInvoicePayable(invoice));
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load invoice for email.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, initialInvoiceId, initialContactId]);

  const [prevHasPaymentToken, setPrevHasPaymentToken] = useState(emailHasPaymentLinkToken);
  if (prevHasPaymentToken !== emailHasPaymentLinkToken) {
    setPrevHasPaymentToken(emailHasPaymentLinkToken);
    if (emailHasPaymentLinkToken) setIncludePaymentLink(true);
  }

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
          const nums = active[0].phoneNumbers.map((line) => line.phoneNumber);
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
        setSelectableTotal(res.selectableTotal ?? res.total);
        const blocked = new Set(
          res.contacts.filter((contact) => contact.doNotNotify).map((contact) => contact._id),
        );
        if (blocked.size > 0) {
          setSelectedIds((prev) => {
            if (![...prev].some((id) => blocked.has(id))) return prev;
            const next = new Set(prev);
            for (const id of blocked) next.delete(id);
            return next;
          });
          setSelectedContactsById((prev) => {
            if (!Object.keys(prev).some((id) => blocked.has(id))) return prev;
            const next = { ...prev };
            for (const id of blocked) delete next[id];
            return next;
          });
        }
        setSelectedContactsById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const c of res.contacts) {
            if (c.doNotNotify) continue;
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
        setEmailSelectableTotal(res.selectableTotal ?? res.total);
        const blocked = new Set(
          res.contacts.filter((contact) => contact.doNotNotify).map((contact) => contact._id),
        );
        if (blocked.size > 0) {
          setEmailSelectedIds((prev) => {
            if (![...prev].some((id) => blocked.has(id))) return prev;
            const next = new Set(prev);
            for (const id of blocked) next.delete(id);
            return next;
          });
          setEmailSelectedContactsById((prev) => {
            if (!Object.keys(prev).some((id) => blocked.has(id))) return prev;
            const next = { ...prev };
            for (const id of blocked) delete next[id];
            return next;
          });
        }
        setEmailSelectedContactsById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const c of res.contacts) {
            if (c.doNotNotify) continue;
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
    ].filter((id): id is string => Boolean(id));
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
            const value = c.customerRef ? map.get(c.customerRef) : undefined;
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
            const value = contact.customerRef ? map.get(contact.customerRef) : undefined;
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
    if (!token || !smsUsesPaymentLink) return;
    const customerIds = [
      ...new Set([
        ...contacts.map((c) => c.customerRef),
        ...Object.values(selectedContactsById).map((c) => c.customerRef),
      ]),
    ].filter((id): id is string => Boolean(id));
    if (customerIds.length === 0) return;

    let cancelled = false;
    getEmailPaymentLinkAvailability(token, customerIds)
      .then((res) => {
        if (cancelled) return;
        const map = new Map(
          res.available.map((row) => [row.customerId, row.hasPayableInvoice]),
        );
        setContacts((prev) => {
          let changed = false;
          const next = prev.map((c) => {
            const value = c.customerRef ? map.get(c.customerRef) : undefined;
            if (value === undefined || c.hasPayableInvoice === value) return c;
            changed = true;
            return { ...c, hasPayableInvoice: value };
          });
          return changed ? next : prev;
        });
        setSelectedContactsById((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [id, contact] of Object.entries(prev)) {
            const value = contact.customerRef ? map.get(contact.customerRef) : undefined;
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
  }, [token, smsUsesPaymentLink, contacts, selectedContactsById]);

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
    const previewOffer =
      previewContactId &&
      Object.prototype.hasOwnProperty.call(
        smsOfferContractOverrides,
        previewContactId,
      )
        ? smsOfferContractOverrides[previewContactId]
        : smsOfferContractTemplateId;

    const editingSmsTemplate =
      activeTab === "templates" && templateEditorType === "sms";
    const savedTemplate = templates.find((t) => t._id === selectedTemplateId);
    const previewVariants = editingSmsTemplate
      ? renewalVariants.enabled
        ? renewalVariants
        : undefined
      : savedTemplate?.renewalVariants?.enabled
        ? savedTemplate.renewalVariants
        : undefined;
    const previewStatus =
      editingSmsTemplate && renewalVariants.enabled ? smsVariantTab : undefined;
    const previewSourceKey = variantBodyKey(smsVariantTab);
    const previewSource =
      editingSmsTemplate && renewalVariants.enabled && previewSourceKey
        ? renewalVariants[previewSourceKey]
        : body;

    const timer = setTimeout(() => {
      previewMessagingMessage(token, {
        body,
        contactId: previewContactId,
        renewalYear: useRenewalsFilter ? viewYear : undefined,
        renewalMonth: useRenewalsFilter ? viewMonth + 1 : undefined,
        includePaymentLink: smsIncludePaymentLink,
        offerContractTemplateId: previewOffer,
        invoiceId: initialInvoiceId ?? undefined,
        renewalVariants: previewVariants,
        previewStatus,
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
          setPreviewText(previewSource);
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
    smsIncludePaymentLink,
    smsOfferContractTemplateId,
    smsOfferContractOverrides,
    initialInvoiceId,
    templates,
    selectedTemplateId,
    renewalVariants,
    smsVariantTab,
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
    const previewOffer =
      previewContactId &&
      Object.prototype.hasOwnProperty.call(
        offerContractOverrides,
        previewContactId,
      )
        ? offerContractOverrides[previewContactId]
        : offerContractTemplateId;

    const timer = setTimeout(() => {
      previewEmailMessage(token, {
        subject: emailSubject,
        body: emailBody,
        emailChrome: mergeEmailChrome(emailChrome),
        contactId: previewContactId,
        renewalYear: emailUseRenewalsFilter ? emailViewYear : undefined,
        renewalMonth: emailUseRenewalsFilter ? emailViewMonth + 1 : undefined,
        includePaymentLink,
        offerContractTemplateId: previewOffer,
        invoiceId: initialInvoiceId ?? undefined,
      })
        .then((res) => {
          if (cancelled) return;
          setEmailPreviewSubject(res.renderedSubject);
          setEmailPreviewHtml(res.html);
          setEmailPreviewSample(res.sample);
          if (previewContactId) {
            const c =
              emailSelectedContactsById[previewContactId] ??
              emailContacts.find((x) => x._id === previewContactId);
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
    emailSelectedContactsById,
    emailContacts,
    emailUseRenewalsFilter,
    emailViewYear,
    emailViewMonth,
    includePaymentLink,
    offerContractTemplateId,
    offerContractOverrides,
    initialInvoiceId,
  ]);

  useEffect(() => {
    if (!token) return;
    if (
      activeTab !== "email" &&
      activeTab !== "create" &&
      activeTab !== "templates"
    ) {
      return;
    }
    let cancelled = false;
    getContractTemplates(token)
      .then((res) => {
        if (cancelled) return;
        setContractTemplates(
          res.templates.filter((template) => template.cost > 0 && !template.deletedAt),
        );
      })
      .catch(() => {
        if (!cancelled) setContractTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, activeTab, templateEditorType]);

  function selectSmsTemplate(template: MessageTemplateItem) {
    setSelectedTemplateId(template._id);
    setTemplateName(template.name);
    setBody(template.body ?? "");
    setRenewalVariants(renewalVariantsFrom(template));
    setSmsOfferContractTemplateId(template.offerContractTemplateId ?? null);
    setSmsOfferContractOverrides({});
  }

  function startNewSmsTemplate() {
    setSelectedTemplateId(null);
    setTemplateName("");
    setBody(DEFAULT_SMS_BODY);
    setRenewalVariants(DEFAULT_RENEWAL_VARIANTS);
    setSmsVariantTab("due_soon");
    setSmsOfferContractTemplateId(null);
    setSmsOfferContractOverrides({});
  }

  function selectEmailTemplate(template: MessageTemplateItem) {
    setSelectedEmailTemplateId(template._id);
    setEmailTemplateName(template.name);
    setEmailSubject(template.subject || DEFAULT_EMAIL_SUBJECT);
    setEmailBody(template.body ?? "");
    setEmailChrome(mergeEmailChrome(template.emailChrome));
    setOfferContractTemplateId(template.offerContractTemplateId ?? null);
    setOfferContractOverrides({});
  }

  function startNewEmailTemplate() {
    setSelectedEmailTemplateId(null);
    setEmailTemplateName("");
    setEmailSubject(DEFAULT_EMAIL_SUBJECT);
    setEmailBody(DEFAULT_EMAIL_BODY);
    setEmailChrome(DEFAULT_EMAIL_CHROME);
    setOfferContractTemplateId(null);
    setOfferContractOverrides({});
  }

  function setSmsOfferOverride(contactId: string, value: string) {
    setSmsOfferContractOverrides((prev) => {
      const next = { ...prev };
      if (value === "") delete next[contactId];
      else if (value === "none") next[contactId] = null;
      else next[contactId] = value;
      return next;
    });
  }

  function applySmsOfferOverrides(contactIds: string[], value: string) {
    setSmsOfferContractOverrides((prev) => {
      const next = { ...prev };
      for (const id of contactIds) {
        if (value === "") delete next[id];
        else if (value === "none") next[id] = null;
        else next[id] = value;
      }
      return next;
    });
  }

  function setOfferOverride(contactId: string, value: string) {
    setOfferContractOverrides((prev) => {
      const next = { ...prev };
      if (value === "") delete next[contactId];
      else if (value === "none") next[contactId] = null;
      else next[contactId] = value;
      return next;
    });
  }

  function applyOfferOverrides(contactIds: string[], value: string) {
    setOfferContractOverrides((prev) => {
      const next = { ...prev };
      for (const id of contactIds) {
        if (value === "") delete next[id];
        else if (value === "none") next[id] = null;
        else next[id] = value;
      }
      return next;
    });
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
    const tokenText = `{{${key}}}`;
    const field =
      activeTab === "templates" && renewalVariants.enabled
        ? variantBodyKey(smsVariantTab)
        : null;
    if (field) {
      insertAtCursor(
        bodyRef.current,
        renewalVariants[field],
        (next) =>
          setRenewalVariants((prev) => ({ ...prev, [field]: next })),
        tokenText,
      );
      return;
    }
    insertAtCursor(bodyRef.current, body, setBody, tokenText);
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
          offerContractTemplateId: isEmail
            ? offerContractTemplateId
            : smsOfferContractTemplateId,
          renewalVariants: isEmail ? null : renewalVariants,
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
          offerContractTemplateId: isEmail
            ? offerContractTemplateId
            : smsOfferContractTemplateId,
          renewalVariants: isEmail ? null : renewalVariants,
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
    if (contact.doNotNotify && !ids.has(id)) return;
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
    const selectable = pageContacts.filter((contact) => !contact.doNotNotify);
    const pageIds = selectable.map((c) => c._id);
    if (pageIds.length === 0) {
      return { selected: false, nextSize: ids.size };
    }
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
        if (c.doNotNotify) continue;
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
    setRenewalVariants(DEFAULT_RENEWAL_VARIANTS);
    setSmsVariantTab("due_soon");
    setMediaUrlsRaw("");
    setSmsIncludePaymentLink(false);
    setSmsOfferContractTemplateId(null);
    setSmsOfferContractOverrides({});
    setError(null);
    setMessageScheduleResult(null);
    setMessageScheduleDate(formatLocalDate(new Date()));
    setMessageScheduleTime("");
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
    setIncludePaymentLink(false);
    setOfferContractTemplateId(null);
    setOfferContractOverrides({});
    setEmailFromNickname(selectedEmailAccount?.fromName ?? "");
    setEmailReplyTo("");
    setEmailEmailsPerSecond(2);
    setEmailScheduleDate(formatLocalDate(new Date()));
    setEmailScheduleTime("");
    setError(null);
    setEmailScheduleResult(null);
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
        if (c.doNotNotify) continue;
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

  async function handleMessageSchedule() {
    if (!token) return;
    if (selectedIds.size === 0) {
      setError("Select at least one contact.");
      return;
    }
    const scheduledTemplate = templates.find((t) => t._id === selectedTemplateId);
    const scheduledVariants = scheduledTemplate?.renewalVariants;
    const hasVariantCopy = Boolean(
      scheduledVariants?.enabled &&
        [scheduledVariants.expired, scheduledVariants.dueSoon, scheduledVariants.active].some(
          (part) => part.trim(),
        ),
    );
    if (!body.trim() && !hasVariantCopy) {
      setError("Message body is empty.");
      return;
    }
    if (!accountId || !effectiveFromNumber) {
      setError("Select a Twilio account and from number.");
      return;
    }
    if (!messageScheduleDate || !messageScheduleTime) {
      setError("Choose a date and time to schedule this message.");
      return;
    }
    const scheduledAt = localDateTimeToIso(
      messageScheduleDate,
      messageScheduleTime,
    );
    if (!isEmailScheduleTimeValid(scheduledAt)) {
      setError("Scheduled time must be at least 1 minute in the future.");
      return;
    }

    const mediaUrls = mediaUrlsRaw
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);

    setSending(true);
    setError(null);
    setMessageScheduleResult(null);
    try {
      const result = await scheduleMessagingMessages(token, {
        contactIds: [...selectedIds],
        body,
        templateId: selectedTemplateId ?? undefined,
        twilioAccountId: accountId,
        fromNumber: effectiveFromNumber,
        mediaUrls: mediaUrls.length ? mediaUrls : undefined,
        renewalYear: useRenewalsFilter ? viewYear : undefined,
        renewalMonth: useRenewalsFilter ? viewMonth + 1 : undefined,
        includePaymentLink: smsIncludePaymentLink,
        invoiceId: initialInvoiceId ?? undefined,
        expectedAmountCents: invoiceAmountCents,
        offerContractTemplateId: smsOfferContractTemplateId,
        offerContractOverrides: Object.entries(smsOfferContractOverrides).map(
          ([contactId, contractTemplateId]) => ({
            contactId,
            contractTemplateId,
          }),
        ),
        scheduledAt,
      });
      setMessageScheduleResult(result.scheduled);
      setConfirmOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to schedule messages.",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleEmailSchedule() {
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
    if (!emailScheduleDate || !emailScheduleTime) {
      setError("Choose a date and time to schedule this email.");
      return;
    }
    const scheduledAt = localDateTimeToIso(
      emailScheduleDate,
      emailScheduleTime,
    );
    if (!isEmailScheduleTimeValid(scheduledAt)) {
      setError("Scheduled time must be at least 1 minute in the future.");
      return;
    }

    setEmailSending(true);
    setError(null);
    setEmailScheduleResult(null);
    try {
      const result = await scheduleEmailMessages(token, {
        expectedAmountCents: invoiceAmountCents,
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
        includePaymentLink,
        offerContractTemplateId,
        invoiceId: initialInvoiceId ?? undefined,
        offerContractOverrides: Object.entries(offerContractOverrides).map(
          ([contactId, contractTemplateId]) => ({
            contactId,
            contractTemplateId,
          }),
        ),
        scheduledAt,
      });
      setEmailScheduleResult(result.scheduled);
      setEmailConfirmOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to schedule emails.",
      );
    } finally {
      setEmailSending(false);
    }
  }

  if (!token || legacyInboxLink) return null;

  return (
    <div className="space-y-4">
      <MobileTabBar className="border-b border-neutral-200">
        {(
          [
            ["contact-form", "Contact Form"],
            ["templates", "Templates"],
            ["create", "Message Wizard"],
            ["email", "Email Wizard"],
            ["communications-log", "Communications Log"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={`shrink-0 border-b-2 px-2 pb-3 text-sm font-medium transition-colors md:px-1 ${
              activeTab === value
                ? "border-brand-orange text-brand-dark"
                : "border-transparent text-neutral-500 hover:text-brand-dark"
            }`}
          >
            {label}
          </button>
        ))}
      </MobileTabBar>

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
          renewalVariants={renewalVariants}
          onRenewalVariantsChange={setRenewalVariants}
          variantTab={smsVariantTab}
          onVariantTabChange={setSmsVariantTab}
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
          contractTemplates={contractTemplates}
          offerContractTemplateId={
            templateEditorType === "email"
              ? offerContractTemplateId
              : smsOfferContractTemplateId
          }
          onOfferContractTemplateIdChange={
            templateEditorType === "email"
              ? setOfferContractTemplateId
              : setSmsOfferContractTemplateId
          }
          error={error}
        />
      ) : activeTab === "create" ? (
        <div className="space-y-4">
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--staff-border)]">
            {(
              [
                ["wizard", "Message Wizard"],
                ["sent-messages", "Sent Messages"],
                ["scheduled", "Scheduled Messages"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setMessageSubTab(val)}
                className={`shrink-0 border-b-2 px-3 pb-2 text-sm font-medium transition-colors ${
                  messageSubTab === val
                    ? "border-brand-orange text-brand-dark"
                    : "border-transparent text-neutral-500 hover:text-brand-dark"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {messageSubTab === "sent-messages" ? (
            <SentMessagesPanel token={token} />
          ) : messageSubTab === "scheduled" ? (
            <ScheduledMessagesPanel token={token} />
          ) : (
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
          selectableTotal={selectableTotal}
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
                selectableTotal > contacts.filter((contact) => !contact.doNotNotify).length &&
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
          onConfirmSchedule={handleMessageSchedule}
          onCancelFlow={resetCreateFlow}
          scheduleDate={messageScheduleDate}
          scheduleTime={messageScheduleTime}
          onScheduleDateChange={setMessageScheduleDate}
          onScheduleTimeChange={setMessageScheduleTime}
          previewText={previewText}
          previewContactLabel={previewContactLabel}
          previewSample={previewSample}
          error={error}
          scheduleResult={messageScheduleResult}
          onDismissScheduleResult={() => setMessageScheduleResult(null)}
          onViewScheduled={() => {
            setMessageScheduleResult(null);
            setActiveTab("create");
            setMessageSubTab("scheduled");
          }}
          showPaymentLinkColumn={smsUsesPaymentLink}
          includePaymentLink={smsIncludePaymentLink}
          onIncludePaymentLinkChange={setSmsIncludePaymentLink}
          contractTemplates={contractTemplates}
          offerContractTemplateId={smsOfferContractTemplateId}
          offerOverrides={smsOfferContractOverrides}
          onOfferContractTemplateIdChange={setSmsOfferContractTemplateId}
          onOfferOverrideChange={setSmsOfferOverride}
          onApplyOfferOverrides={applySmsOfferOverrides}
        />
          )}
        </div>
      ) : activeTab === "email" ? (
        <div className="space-y-4">
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--staff-border)]">
            {(
              [
                ["wizard", "Email Wizard"],
                ["sent-emails", "Sent Emails"],
                ["scheduled", "Scheduled Emails"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setEmailSubTab(val)}
                className={`shrink-0 border-b-2 px-3 pb-2 text-sm font-medium transition-colors ${
                  emailSubTab === val
                    ? "border-brand-orange text-brand-dark"
                    : "border-transparent text-neutral-500 hover:text-brand-dark"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {emailSubTab === "sent-emails" ? (
            <SentEmailsPanel token={token} initialEmailId={sentEmailId} />
          ) : emailSubTab === "scheduled" ? (
            <ScheduledEmailsPanel token={token} />
          ) : (
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
          selectableTotal={emailSelectableTotal}
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
                emailSelectableTotal >
                  emailContacts.filter((contact) => !contact.doNotNotify).length &&
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
          onConfirmSchedule={handleEmailSchedule}
          onCancelFlow={resetEmailCreateFlow}
          scheduleDate={emailScheduleDate}
          scheduleTime={emailScheduleTime}
          onScheduleDateChange={setEmailScheduleDate}
          onScheduleTimeChange={setEmailScheduleTime}
          previewSubject={emailPreviewSubject}
          previewHtml={emailPreviewHtml}
          previewFromLabel={emailFromLabel}
          previewToLabel={emailPreviewTo}
          previewSample={emailPreviewSample}
          showPaymentLinkColumn={emailUsesPaymentLink}
          includePaymentLink={includePaymentLink}
          onIncludePaymentLinkChange={setIncludePaymentLink}
          contractTemplates={contractTemplates}
          offerContractTemplateId={offerContractTemplateId}
          offerOverrides={offerContractOverrides}
          onOfferContractTemplateIdChange={setOfferContractTemplateId}
          onOfferOverrideChange={setOfferOverride}
          onApplyOfferOverrides={applyOfferOverrides}
          error={error}
          scheduleResult={emailScheduleResult}
          onDismissScheduleResult={() => setEmailScheduleResult(null)}
          onViewScheduled={() => {
            setEmailScheduleResult(null);
            setActiveTab("email");
            setEmailSubTab("scheduled");
          }}
        />
          )}
        </div>
      ) : activeTab === "communications-log" ? (
        <CommunicationsLogPanel token={token} />
      ) : (
        <ContactFormSubmissionsPanel token={token} />
      )}
    </div>
  );
}
