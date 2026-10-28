"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import InvoiceLayout from "@/components/billing/InvoiceLayout";
import { ApiError, getPublicInvoiceView, type InvoiceItem } from "@/lib/api";
import { normalizeBlocks, type InvoiceBlock } from "@/lib/invoice-template";
import { journeyStep, startPaymentJourney } from "@/lib/paymentJourney";

export default function PublicInvoicePage() {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-neutral-500">Loading…</p>}>
      <PublicInvoiceContent />
    </Suspense>
  );
}

function PublicInvoiceContent() {
  const token = (useSearchParams().get("t") ?? "").trim();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [blocks, setBlocks] = useState<InvoiceBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token) return;
    return startPaymentJourney({ entry: "invoice_view", link: { viewToken: token } });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPublicInvoiceView(token)
      .then((res) => {
        if (cancelled) return;
        journeyStep("invoice_loaded", `${res.invoice.number} · ${res.invoice.status}`);
        setInvoice(res.invoice);
        setBlocks(normalizeBlocks(res.blocks));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? err.message : "This invoice link is not valid.";
        journeyStep("link_invalid", message);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function downloadPdf() {
    if (!sheetRef.current || !invoice) return;
    journeyStep("pdf_download_clicked");
    setDownloading(true);
    setError(null);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: 0.4,
          filename: `Invoice-${invoice.number}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
        })
        .from(sheetRef.current)
        .save();
      journeyStep("pdf_downloaded");
    } catch (err) {
      journeyStep("pdf_failed", err instanceof Error ? err.message : "unknown error");
      setError("The PDF could not be created. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        {!token ? (
          <p className="text-sm text-red-600">This invoice link is missing.</p>
        ) : loading ? (
          <p className="text-sm text-neutral-500">Loading invoice…</p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {invoice && blocks ? (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={downloading}
                onClick={() => void downloadPdf()}
                className="rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {downloading ? "Preparing PDF…" : "Download PDF"}
              </button>
            </div>
            <div ref={sheetRef}>
              <InvoiceLayout invoice={invoice} blocks={blocks} isCustomer />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
