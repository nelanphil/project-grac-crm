"use client";

import { useEffect, useState } from "react";
import InvoiceLayout, { invoiceArticleClass } from "@/components/billing/InvoiceLayout";
import type { InvoiceItem } from "@/lib/api";
import { ApiError, getDefaultInvoiceTemplate } from "@/lib/api";
import { defaultInvoiceBlocks, normalizeBlocks, type InvoiceBlock } from "@/lib/invoice-template";
import { useAuthStore } from "@/store/useAuthStore";

export default function InvoiceDocument({
  invoice,
  isCustomer,
}: {
  invoice: InvoiceItem;
  isCustomer: boolean;
}) {
  const token = useAuthStore((s) => s.token);
  const [blocks, setBlocks] = useState<InvoiceBlock[] | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getDefaultInvoiceTemplate(token)
      .then(({ template }) => {
        if (!cancelled) setBlocks(normalizeBlocks(template.blocks));
      })
      .catch((err) => {
        if (cancelled) return;
        if (!(err instanceof ApiError)) {
          console.error(err);
        }
        setBlocks(defaultInvoiceBlocks());
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!blocks) {
    return (
      <article className={invoiceArticleClass(isCustomer)}>
        <p className="text-sm text-neutral-500">Loading invoice…</p>
      </article>
    );
  }

  return <InvoiceLayout invoice={invoice} blocks={blocks} isCustomer={isCustomer} />;
}
