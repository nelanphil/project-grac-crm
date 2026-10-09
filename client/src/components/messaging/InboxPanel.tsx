"use client";

import { useState } from "react";
import { MailboxFolder, TwilioAccountItem } from "@/lib/api";
import EmailInboxPanel from "./EmailInboxPanel";
import ThreadsPanel from "./ThreadsPanel";

export type InboxView = "text" | "email";

type InboxPanelProps = {
  token: string;
  accounts: TwilioAccountItem[];
  initialView: InboxView;
  initialEmailAccountId?: string;
  initialEmailFolder?: MailboxFolder;
  initialEmailUid?: number | null;
};

const VIEWS: { id: InboxView; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "email", label: "Email" },
];

export default function InboxPanel({
  token,
  accounts,
  initialView,
  initialEmailAccountId,
  initialEmailFolder,
  initialEmailUid,
}: InboxPanelProps) {
  const [view, setView] = useState<InboxView>(initialView);
  const incomingEmailLink =
    initialEmailAccountId && initialEmailUid
      ? `${initialEmailAccountId}:${initialEmailFolder ?? "inbox"}:${initialEmailUid}`
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
        />
      ) : (
        <ThreadsPanel token={token} accounts={accounts} />
      )}
    </div>
  );
}
