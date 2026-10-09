"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type {
  InvoiceCustomerSummary,
  InvoiceItem,
  InvoiceServiceAddress,
} from "@/lib/api";
import { COMPANY } from "@/lib/constants";
import {
  invoiceTextCss,
  type InvoiceBlock,
  type InvoiceColumnsBlock,
  type InvoiceLeafBlock,
  type InvoiceTextStyle,
} from "@/lib/invoice-template";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
}

function formatAddressLines(parts: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}): string[] {
  const lines: string[] = [];
  if (parts.address?.trim()) lines.push(parts.address.trim());
  const state = parts.state?.trim().toUpperCase() ?? "";
  const cityStateZip = [parts.city?.trim(), [state, parts.zip?.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  if (cityStateZip) lines.push(cityStateZip);
  return lines;
}

function addressesEqual(
  a: InvoiceCustomerSummary | null | undefined,
  b: InvoiceServiceAddress | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.address.trim().toLowerCase() === b.address.trim().toLowerCase() &&
    a.city.trim().toLowerCase() === b.city.trim().toLowerCase() &&
    a.state.trim().toLowerCase() === b.state.trim().toLowerCase() &&
    a.zip.trim().toLowerCase() === b.zip.trim().toLowerCase()
  );
}

function FieldLabel({ children, style }: { children: ReactNode; style: InvoiceTextStyle }) {
  return (
    <p className="uppercase tracking-wide" style={invoiceTextCss(style)}>
      {children}
    </p>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="text-sm italic text-neutral-400">{children}</p>;
}

const textHtmlClass =
  "text-sm text-neutral-700 [&_a]:text-brand-orange [&_a]:underline [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:ml-5 [&_ul]:list-disc";

export function invoiceArticleClass(isCustomer: boolean): string {
  return `invoice-document rounded-xl border border-neutral-200 bg-white px-4 py-6 shadow-sm sm:px-10 sm:py-10 print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none ${isCustomer ? "uppercase" : ""}`;
}

function showServiceAddress(invoice: InvoiceItem): boolean {
  const serviceAddress = invoice.serviceAddress;
  return (
    Boolean(serviceAddress?.address?.trim()) &&
    !addressesEqual(invoice.customer, serviceAddress)
  );
}

export function InvoiceColumnsFrame({
  block,
  left,
  right,
}: {
  block: InvoiceColumnsBlock;
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className={block.showDivider ? "border-b border-neutral-200 pb-6" : undefined}>
      <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
        <div className="min-w-0 space-y-5">{left}</div>
        <div className="min-w-0 space-y-5">{right}</div>
      </div>
    </div>
  );
}

export function InvoiceBlockBody({
  block,
  invoice,
  isCustomer,
  editing = false,
  textEditor,
}: {
  block: InvoiceBlock;
  invoice: InvoiceItem;
  isCustomer: boolean;
  editing?: boolean;
  textEditor?: ReactNode;
}) {
  if (block.type === "columns") {
    return (
      <InvoiceColumnsFrame
        block={block}
        left={block.left.map((child) => (
          <InvoiceBlockBody
            key={child.id}
            block={child}
            invoice={invoice}
            isCustomer={isCustomer}
            editing={editing}
          />
        ))}
        right={block.right.map((child) => (
          <InvoiceBlockBody
            key={child.id}
            block={child}
            invoice={invoice}
            isCustomer={isCustomer}
            editing={editing}
          />
        ))}
      />
    );
  }

  return (
    <LeafBody
      block={block}
      invoice={invoice}
      isCustomer={isCustomer}
      editing={editing}
      textEditor={textEditor}
    />
  );
}

function LeafBody({
  block,
  invoice,
  isCustomer,
  editing,
  textEditor,
}: {
  block: InvoiceLeafBlock;
  invoice: InvoiceItem;
  isCustomer: boolean;
  editing: boolean;
  textEditor?: ReactNode;
}) {
  switch (block.type) {
    case "text": {
      const html = block.html.trim();
      const empty = !html || html === "<p></p>";
      const body = textEditor ?? (
        empty ? (
          editing ? <Placeholder>Click to write…</Placeholder> : null
        ) : (
          <div className={textHtmlClass} dangerouslySetInnerHTML={{ __html: html }} />
        )
      );
      if (!body) return null;
      if (block.tone === "muted") {
        return (
          <div className="mt-4 border-t border-neutral-200 pt-6 text-center text-xs text-neutral-500 [&_p]:mb-1">
            {body}
          </div>
        );
      }
      return <div style={{ textAlign: block.align }}>{body}</div>;
    }
    case "image": {
      const widthClass =
        block.width === "sm" ? "max-w-32" : block.width === "md" ? "max-w-64" : "w-full";
      const alignClass =
        block.align === "center"
          ? "justify-center"
          : block.align === "right"
            ? "justify-end"
            : "justify-start";
      if (!block.url) {
        return editing ? <Placeholder>Add an image from the sidebar.</Placeholder> : null;
      }
      return (
        <div className={`flex ${alignClass}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt} className={`${widthClass} h-auto`} />
        </div>
      );
    }
    case "spacer":
      return <div style={{ height: block.height }} aria-hidden />;
    case "divider":
      return <hr className="border-neutral-200" />;
    case "heading":
      return (
        <div>
          <p className="uppercase tracking-[0.2em]" style={invoiceTextCss(block.labelStyle)}>
            {block.label}
          </p>
          {block.showNumber ? (
            <p className="mt-1 break-words" style={invoiceTextCss(block.valueStyle)}>
              {invoice.number}
            </p>
          ) : null}
          {block.showSource ? (
            <p
              className={`mt-1 ${isCustomer ? "" : "capitalize"}`}
              style={invoiceTextCss(block.labelStyle)}
            >
              {invoice.sourceType.replace(/_/g, " ")}
            </p>
          ) : null}
        </div>
      );
    case "company": {
      const visible =
        block.showName || block.showPhone || block.showEmail || block.showLicense;
      if (!visible) return editing ? <Placeholder>Company details are hidden.</Placeholder> : null;
      return (
        <div className="space-y-0.5">
          {block.showName ? (
            <p style={invoiceTextCss(block.valueStyle)}>{COMPANY.name}</p>
          ) : null}
          {block.showPhone ? (
            <p style={invoiceTextCss(block.labelStyle)}>
              <a href={COMPANY.phoneHref} className="hover:text-brand-orange print:no-underline">
                {COMPANY.phone}
              </a>
            </p>
          ) : null}
          {block.showEmail ? (
            <p style={invoiceTextCss(block.labelStyle)}>
              <a
                href={`mailto:${COMPANY.email}`}
                className="hover:text-brand-orange print:no-underline"
              >
                {COMPANY.email}
              </a>
            </p>
          ) : null}
          {block.showLicense ? (
            <p style={invoiceTextCss(block.labelStyle)}>{COMPANY.license}</p>
          ) : null}
        </div>
      );
    }
    case "billTo": {
      const billTo = invoice.customer ?? null;
      const lines = billTo ? formatAddressLines(billTo) : [];
      return (
        <div className={block.align === "right" ? "sm:text-right" : undefined}>
          <FieldLabel style={block.labelStyle}>{block.label}</FieldLabel>
          {billTo ? (
            <div className="mt-2 space-y-0.5" style={invoiceTextCss(block.valueStyle)}>
              <p>
                {!isCustomer && invoice.customerRef ? (
                  <Link
                    href={`/dashboard/customers/detail?id=${invoice.customerRef}`}
                    className="hover:text-brand-orange print:no-underline"
                  >
                    {billTo.name}
                  </Link>
                ) : (
                  billTo.name
                )}
              </p>
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {block.showPhone && billTo.phone ? <p>{billTo.phone}</p> : null}
              {block.showEmail && billTo.email ? <p>{billTo.email}</p> : null}
            </div>
          ) : (
            <p className="mt-2" style={invoiceTextCss(block.valueStyle)}>
              Customer #{invoice.customerId}
            </p>
          )}
        </div>
      );
    }
    case "meta": {
      const fields: { label: string; value: string; capitalize?: boolean }[] = [];
      if (block.showIssued) fields.push({ label: "Issued", value: formatDate(invoice.issuedAt) });
      if (block.showDue) fields.push({ label: "Due", value: formatDate(invoice.dueDate) });
      if (block.showStatus) {
        fields.push({ label: "Status", value: invoice.status, capitalize: !isCustomer });
      }
      if (block.showPaid) fields.push({ label: "Paid", value: formatDate(invoice.paidAt) });
      if (fields.length === 0) {
        return editing ? (
          <Placeholder>Choose at least one date or status.</Placeholder>
        ) : null;
      }
      return (
        <div className="grid grid-cols-2 gap-4 border-b border-neutral-200 pb-6 sm:grid-cols-4">
          {fields.map((field) => (
            <div key={field.label}>
              <FieldLabel style={block.labelStyle}>{field.label}</FieldLabel>
              <p
                className={`mt-1 ${field.capitalize ? "capitalize" : ""}`}
                style={invoiceTextCss(block.valueStyle)}
              >
                {field.value}
              </p>
            </div>
          ))}
        </div>
      );
    }
    case "serviceAddress": {
      const serviceAddress = invoice.serviceAddress;
      if (!showServiceAddress(invoice) || !serviceAddress) {
        return editing ? (
          <Placeholder>
            Service address appears when it differs from the bill-to address.
          </Placeholder>
        ) : null;
      }
      const lines = formatAddressLines(serviceAddress);
      return (
        <div className="border-b border-neutral-200 pb-6">
          <FieldLabel style={block.labelStyle}>{block.label}</FieldLabel>
          <div className="mt-2 space-y-0.5" style={invoiceTextCss(block.valueStyle)}>
            {serviceAddress.label ? <p>{serviceAddress.label}</p> : null}
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      );
    }
    case "lineItems":
      return (
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-neutral-300">
              <th
                className="py-3 text-left uppercase tracking-wide"
                style={invoiceTextCss(block.labelStyle)}
              >
                {block.descriptionLabel}
              </th>
              <th
                className="py-3 text-right uppercase tracking-wide"
                style={invoiceTextCss(block.labelStyle)}
              >
                {block.amountLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-6" style={invoiceTextCss(block.valueStyle)}>
                  No line items.
                </td>
              </tr>
            ) : (
              invoice.lineItems.map((item, index) => (
                <tr key={`${item.description}-${index}`} className="border-b border-neutral-100">
                  <td
                    className="break-words py-3 pr-3"
                    style={invoiceTextCss(block.valueStyle)}
                  >
                    {item.description}
                  </td>
                  <td className="py-3 text-right" style={invoiceTextCss(block.valueStyle)}>
                    {formatMoney(item.amountCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      );
    case "totals": {
      const hasDiscount = Boolean(invoice.discountCents && invoice.discountCents > 0);
      const subtotal = invoice.originalAmountCents ?? invoice.amountCents;
      const total = hasDiscount
        ? Math.max(subtotal - (invoice.discountCents ?? 0), 0)
        : invoice.amountCents;
      return (
        <div className="ml-auto w-full max-w-xs">
          {hasDiscount ? (
            <>
              <div className="flex justify-between gap-4" style={invoiceTextCss(block.labelStyle)}>
                <span>Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div
                className="mt-2 flex justify-between gap-4"
                style={invoiceTextCss(block.labelStyle)}
              >
                <span>Discount{invoice.discountCode ? ` ${invoice.discountCode}` : ""}</span>
                <span>−{formatMoney(invoice.discountCents ?? 0)}</span>
              </div>
            </>
          ) : null}
          <div className="mt-3 flex justify-between gap-4" style={invoiceTextCss(block.valueStyle)}>
            <span>{block.totalLabel}</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>
      );
    }
    case "notes": {
      const notes = invoice.workOrderNotes ?? [];
      if (notes.length === 0) {
        return editing ? (
          <Placeholder>Notes appear when the work order has notes.</Placeholder>
        ) : null;
      }
      return (
        <div className="border-t border-neutral-200 pt-6">
          <FieldLabel style={block.labelStyle}>{block.label}</FieldLabel>
          <ul className="mt-2 space-y-3">
            {notes.map((note) => (
              <li
                key={note._id}
                className="whitespace-pre-wrap"
                style={invoiceTextCss(block.valueStyle)}
              >
                {note.content}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "paymentMethod": {
      if (!invoice.paymentProvider) {
        return editing ? (
          <Placeholder>Payment method appears after a payment is recorded.</Placeholder>
        ) : null;
      }
      return (
        <p className={isCustomer ? "" : "capitalize"}>
          <span style={invoiceTextCss(block.labelStyle)}>{block.label}: </span>
          <span style={invoiceTextCss(block.valueStyle)}>{invoice.paymentProvider}</span>
        </p>
      );
    }
    default:
      return null;
  }
}

export default function InvoiceLayout({
  invoice,
  blocks,
  isCustomer,
}: {
  invoice: InvoiceItem;
  blocks: InvoiceBlock[];
  isCustomer: boolean;
}) {
  return (
    <article className={invoiceArticleClass(isCustomer)}>
      <div className="space-y-6">
        {blocks.map((block) => (
          <InvoiceBlockBody
            key={block.id}
            block={block}
            invoice={invoice}
            isCustomer={isCustomer}
          />
        ))}
      </div>
    </article>
  );
}
