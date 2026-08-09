import Link from "next/link";
import {
  InvoiceCustomerSummary,
  InvoiceItem,
  InvoiceServiceAddress,
} from "@/lib/api";
import { COMPANY } from "@/lib/constants";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
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

export default function InvoiceDocument({
  invoice,
  isCustomer,
}: {
  invoice: InvoiceItem;
  isCustomer: boolean;
}) {
  const billTo = invoice.customer ?? null;
  const serviceAddress = invoice.serviceAddress ?? null;
  const showServiceAddress =
    Boolean(serviceAddress?.address?.trim()) &&
    !addressesEqual(billTo, serviceAddress);
  const billToLines = billTo ? formatAddressLines(billTo) : [];
  const serviceLines = serviceAddress
    ? formatAddressLines(serviceAddress)
    : [];

  return (
    <article className="invoice-document rounded-xl border border-neutral-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-10 print:rounded-none print:border-0 print:shadow-none print:px-0 print:py-0">
      <header className="flex flex-wrap items-start justify-between gap-8 border-b border-neutral-200 pb-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
            Invoice
          </p>
          <p className="mt-1 text-2xl font-bold text-brand-dark">
            {invoice.number}
          </p>
          <p className="mt-1 text-sm capitalize text-neutral-500">
            {invoice.sourceType.replace(/_/g, " ")}
          </p>
          <div className="mt-5 space-y-0.5 text-sm text-neutral-600">
            <p className="font-semibold text-brand-dark">{COMPANY.name}</p>
            <p>
              <a
                href={COMPANY.phoneHref}
                className="hover:text-brand-orange print:text-neutral-600 print:no-underline"
              >
                {COMPANY.phone}
              </a>
            </p>
            <p>
              <a
                href={`mailto:${COMPANY.email}`}
                className="hover:text-brand-orange print:text-neutral-600 print:no-underline"
              >
                {COMPANY.email}
              </a>
            </p>
            <p className="text-xs text-neutral-500">{COMPANY.license}</p>
          </div>
        </div>

        <div className="min-w-[12rem] text-right sm:max-w-xs">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Bill to
          </p>
          {billTo ? (
            <div className="mt-2 space-y-0.5 text-sm text-neutral-700">
              <p className="font-semibold text-brand-dark">
                {!isCustomer && invoice.customerRef ? (
                  <Link
                    href={`/dashboard/customers/detail?id=${invoice.customerRef}`}
                    className="hover:text-brand-orange print:text-brand-dark print:no-underline"
                  >
                    {billTo.name}
                  </Link>
                ) : (
                  billTo.name
                )}
              </p>
              {billToLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {billTo.phone ? <p>{billTo.phone}</p> : null}
              {billTo.email ? <p>{billTo.email}</p> : null}
            </div>
          ) : (
            <p className="mt-2 text-sm font-medium text-brand-dark">
              Customer #{invoice.customerId}
            </p>
          )}
        </div>
      </header>

      <div className="mt-6 grid gap-4 border-b border-neutral-200 pb-6 sm:grid-cols-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Issued
          </p>
          <p className="mt-1 text-sm font-medium text-brand-dark">
            {formatDate(invoice.issuedAt)}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Due
          </p>
          <p className="mt-1 text-sm font-medium text-brand-dark">
            {formatDate(invoice.dueDate)}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Status
          </p>
          <p className="mt-1 text-sm font-medium capitalize text-brand-dark">
            {invoice.status}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Paid
          </p>
          <p className="mt-1 text-sm font-medium text-brand-dark">
            {formatDate(invoice.paidAt)}
          </p>
        </div>
      </div>

      {showServiceAddress && serviceAddress ? (
        <div className="mt-6 border-b border-neutral-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Service address
          </p>
          <div className="mt-2 space-y-0.5 text-sm text-neutral-700">
            {serviceAddress.label ? (
              <p className="font-semibold text-brand-dark">
                {serviceAddress.label}
              </p>
            ) : null}
            {serviceLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-300">
              <th className="py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Description
              </th>
              <th className="py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-6 text-neutral-500">
                  No line items.
                </td>
              </tr>
            ) : (
              invoice.lineItems.map((item, index) => (
                <tr
                  key={`${item.description}-${index}`}
                  className="border-b border-neutral-100"
                >
                  <td className="py-3 text-neutral-700">{item.description}</td>
                  <td className="py-3 text-right font-medium text-brand-dark">
                    {formatMoney(item.amountCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 text-base font-semibold text-brand-dark">
                Total due
              </td>
              <td className="pt-4 text-right text-base font-semibold text-brand-dark">
                {formatMoney(invoice.amountCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {invoice.paymentProvider ? (
        <p className="mt-4 text-xs text-neutral-500 capitalize">
          Payment method: {invoice.paymentProvider}
        </p>
      ) : null}

      <footer className="mt-10 border-t border-neutral-200 pt-6 text-center text-xs text-neutral-500">
        <p>Thank you for your business.</p>
        <p className="mt-1">
          Questions? Call {COMPANY.phone} or email {COMPANY.email}
        </p>
      </footer>
    </article>
  );
}
