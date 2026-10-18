"use client";

import { useState } from "react";
import { MailboxFolder, TwilioAccountItem } from "@/lib/api";
import EmailInboxPanel from "./EmailInboxPanel";
import ThreadsPanel from "./ThreadsPanel";
import ContactFormSubmissionsPanel from "./ContactFormSubmissionsPanel";

export type InboxView = "text" | "email" | "contact-form";

type InboxPanelProps = {
  token: string;
  accounts: TwilioAccountItem[];
  initialView: InboxView;
  initialEmailAccountId?: string;
  initialEmailFolder?: MailboxFolder;
  initialEmailUid?: number | null;
  initialEmailMessageId?: string;
};

const VIEWS: { id: InboxView; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "email", label: "Email" },
  { id: "contact-form", label: "Contact Form" },
];

export default function InboxPanel({
  token,
  accounts,
  initialView,
  initialEmailAccountId,
  initialEmailFolder,
  initialEmailUid,
  initialEmailMessageId = "",
}: InboxPanelProps) {
  const [view, setView] = useState<InboxView>(initialView);
  const [appliedInitialView, setAppliedInitialView] = useState(initialView);
  if (initialView !== appliedInitialView) {
    setAppliedInitialView(initialView);
    setView(initialView);
  }
  const messageId = initialEmailMessageId.trim();
  const incomingEmailLink =
    initialEmailAccountId && (initialEmailUid || messageId)
      ? `${initialEmailAccountId}:${initialEmailFolder ?? "inbox"}:${initialEmailUid ?? ""}:${messageId}`
      : "";
  const [appliedEmailLink, setAppliedEmailLink] = useState(incomingEmailLink);
  if (incomingEmailLink && incomingEmailLink !== appliedEmailLink) {
    setAppliedEmailLink(incomingEmailLink);
    setView("email");
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[var(--staff-border)]">
        {VIEWS.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`border-b-2 px-3 pb-2 text-sm font-medium transition-colors ${
                active
                  ? "border-brand-orange text-brand-dark"
                  : "border-transparent text-neutral-500 hover:text-brand-dark"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {view === "email" ? (
        <EmailInboxPanel
          token={token}
          initialAccountId={initialEmailAccountId}
          initialFolder={initialEmailFolder}
          initialUid={initialEmailUid}
          initialMessageId={messageId}
        />
      ) : view === "contact-form" ? (
        <ContactFormSubmissionsPanel token={token} />
      ) : (
        <ThreadsPanel token={token} accounts={accounts} />
      )}
    </div>
  );
}
