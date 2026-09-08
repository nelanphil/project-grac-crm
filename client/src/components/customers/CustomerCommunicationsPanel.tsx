"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ImageIcon,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  type LucideIcon,
} from "lucide-react";
import {
  ApiError,
  CustomerContact,
  getMessagingCommunications,
  getSentEmails,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import CommunicationHistoryPanel, {
  type ChannelFilter,
} from "./CommunicationHistoryPanel";
import CustomerThreadsPanel from "./CustomerThreadsPanel";

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

type ChannelId = Exclude<ChannelFilter, "all">;

const CHANNELS: {
  id: ChannelId;
  label: string;
  icon: LucideIcon;
  needs: "phone" | "email";
  countLabel: (n: number) => string;
}[] = [
  {
    id: "sms",
    label: "SMS",
    icon: MessageSquare,
    needs: "phone",
    countLabel: (n) => `${n} message${n === 1 ? "" : "s"}`,
  },
  {
    id: "mms",
    label: "MMS",
    icon: ImageIcon,
    needs: "phone",
    countLabel: (n) => `${n} message${n === 1 ? "" : "s"}`,
  },
  {
    id: "voice",
    label: "Voice",
    icon: Phone,
    needs: "phone",
    countLabel: (n) => `${n} call${n === 1 ? "" : "s"}`,
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    needs: "email",
    countLabel: (n) => `${n} email${n === 1 ? "" : "s"}`,
  },
];

type CustomerCommunicationsPanelProps = {
  customerId: string;
  contacts: CustomerContact[];
  token: string;
};

export default function CustomerCommunicationsPanel({
  customerId,
  contacts,
  token,
}: CustomerCommunicationsPanelProps) {
  const isAdmin = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );

  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [counts, setCounts] = useState<Partial<Record<ChannelId, number>>>({});
  const [countsLoading, setCountsLoading] = useState(false);

  const phones = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const contact of contacts) {
      const phone = contact.phone?.trim();
      if (!phone) continue;
      const key = phone.replace(/\D/g, "") || phone;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(formatPhone(phone));
    }
    return list;
  }, [contacts]);

  const emails = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const contact of contacts) {
      const email = contact.email?.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(email);
    }
    return list;
  }, [contacts]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setCountsLoading(true);
    });

    Promise.all([
      getMessagingCommunications(token, {
        customerId,
        channel: "sms",
        page: 1,
        pageSize: 1,
      }),
      getMessagingCommunications(token, {
        customerId,
        channel: "mms",
        page: 1,
        pageSize: 1,
      }),
      getMessagingCommunications(token, {
        customerId,
        channel: "voice",
        page: 1,
        pageSize: 1,
      }),
      getSentEmails(token, { customerId, page: 1, pageSize: 1 }),
    ])
      .then(([sms, mms, voice, email]) => {
        if (cancelled) return;
        setCounts({
          sms: sms.total,
          mms: mms.total,
          voice: voice.total,
          email: email.total,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (!(err instanceof ApiError)) return;
        setCounts({});
      })
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, customerId, isAdmin]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-brand-dark">
          Channels
        </h3>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {CHANNELS.map((item) => {
            const Icon = item.icon;
            const methods = item.needs === "phone" ? phones : emails;
            const available = methods.length > 0;
            const selected = channel === item.id;
            const count = counts[item.id];
            const preview =
              methods.length === 0
                ? item.needs === "phone"
                  ? "No phone on file"
                  : "No email on file"
                : methods.length <= 2
                  ? methods.join(" · ")
                  : `${methods.slice(0, 2).join(" · ")} +${methods.length - 2}`;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setChannel((current) =>
                    current === item.id ? "all" : item.id,
                  )
                }
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selected
                    ? "border-brand-orange bg-orange-50"
                    : available
                      ? "border-neutral-200 hover:border-neutral-300"
                      : "border-neutral-200 bg-neutral-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={`h-4 w-4 ${
                      selected ? "text-brand-orange" : "text-neutral-400"
                    }`}
                  />
                  <span className="text-sm font-semibold text-brand-dark">
                    {item.label}
                  </span>
                </div>
                <p
                  className={`mt-2 text-xs ${
                    available ? "text-neutral-600" : "text-neutral-400"
                  }`}
                >
                  {preview}
                </p>
                {isAdmin ? (
                  <p className="mt-1 text-xs font-medium text-neutral-500">
                    {countsLoading ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading
                      </span>
                    ) : count != null ? (
                      item.countLabel(count)
                    ) : (
                      "—"
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-xs font-medium text-neutral-500">
                    {available ? "Available" : "Unavailable"}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {isAdmin ? (
        <>
          <CustomerThreadsPanel
            customerId={customerId}
            contacts={contacts}
            token={token}
            embedded
            channelFilter={channel}
          />
          <CommunicationHistoryPanel
            customerId={customerId}
            contacts={contacts}
            token={token}
            embedded
            channel={channel}
          />
        </>
      ) : null}
    </div>
  );
}
