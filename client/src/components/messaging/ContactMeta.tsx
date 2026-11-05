import type { MessagingContactItem } from "@/lib/api";

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function priorAscLabel(
  prior: MessagingContactItem["priorAscUnpaid"],
): string | null {
  if (!prior || prior.count <= 0) return null;
  const money = formatMoney(prior.totalCents);
  if (prior.count === 1) return `Prior ASC not on this link: ${money}`;
  return `${prior.count} prior ASC not on this link: ${money}`;
}

export function PriorAscNote({
  prior,
}: {
  prior: MessagingContactItem["priorAscUnpaid"];
}) {
  const label = priorAscLabel(prior);
  if (!label) return null;
  return (
    <span className="text-[10px] font-medium leading-snug text-amber-800">
      {label}
    </span>
  );
}

export function checkoutAmountCents(
  contact: Pick<
    MessagingContactItem,
    "hasPayableInvoice" | "paymentLinkAmountCents" | "offerInvoiceAmounts"
  >,
  offerTemplateId: string | null,
  catalog: Record<string, number>,
): number | null {
  if (contact.hasPayableInvoice) {
    return contact.paymentLinkAmountCents ?? null;
  }
  if (!offerTemplateId) return null;
  const saved = contact.offerInvoiceAmounts?.find(
    (row) => row.templateId === offerTemplateId,
  );
  if (saved) return saved.amountCents;
  return catalog[offerTemplateId] ?? null;
}

function formatDate(iso: string | null | undefined, timeZone?: "UTC"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
}

const METHOD_LABEL: Record<
  NonNullable<MessagingContactItem["lastContact"]>["method"],
  string
> = {
  text: "Text",
  email: "Email",
  call: "Phone call",
};

const ATTEMPT_NOTE: Record<string, string> = {
  failed: "Failed",
  "no-answer": "No answer",
  busy: "Busy",
  canceled: "Canceled",
};

export function RenewalStatusBadge({
  contact,
}: {
  contact: Pick<MessagingContactItem, "renewalStatus" | "lastRenewalDate">;
}) {
  if (!contact.renewalStatus) return null;
  if (contact.renewalStatus === "renewed") {
    const when = formatDate(contact.lastRenewalDate, "UTC");
    return (
      <span className="inline-flex rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
        {when ? `Renewed ${when}` : "Renewed"}
      </span>
    );
  }
  if (contact.renewalStatus === "overdue") {
    return (
      <span className="inline-flex rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
        Overdue
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
      Due
    </span>
  );
}

export function LastContactValue({
  contact,
}: {
  contact: Pick<MessagingContactItem, "lastContact">;
}) {
  const last = contact.lastContact;
  if (!last) return <>—</>;
  const when = formatDate(last.at);
  const note = ATTEMPT_NOTE[last.status];
  return (
    <span className="inline-flex flex-col">
      <span>
        {METHOD_LABEL[last.method]}
        {when ? ` · ${when}` : ""}
      </span>
      {note ? (
        <span className="text-[11px] text-neutral-400">{note}</span>
      ) : null}
    </span>
  );
}
