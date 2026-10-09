/**
 * Seeded layout matching the original invoice document.
 * Keep in sync with client/src/lib/invoice-template.ts.
 */
export const DEFAULT_INVOICE_TEMPLATE_NAME = "Standard invoice";

export function defaultInvoiceBlocks(): Record<string, unknown>[] {
  return [
    {
      id: "header-columns",
      type: "columns",
      showDivider: true,
      left: [
        {
          id: "heading",
          type: "heading",
          label: "Invoice",
          showNumber: true,
          showSource: true,
        },
        {
          id: "company",
          type: "company",
          showName: true,
          showPhone: true,
          showEmail: true,
          showLicense: true,
        },
      ],
      right: [
        {
          id: "bill-to",
          type: "billTo",
          label: "Bill to",
          showPhone: true,
          showEmail: true,
          align: "right",
        },
      ],
    },
    {
      id: "meta",
      type: "meta",
      showIssued: true,
      showDue: true,
      showStatus: true,
      showPaid: true,
    },
    {
      id: "service-address",
      type: "serviceAddress",
      label: "Service address",
    },
    {
      id: "line-items",
      type: "lineItems",
      descriptionLabel: "Description",
      amountLabel: "Amount",
    },
    {
      id: "totals",
      type: "totals",
      totalLabel: "Total due",
    },
    {
      id: "notes",
      type: "notes",
      label: "Notes",
    },
    {
      id: "payment-method",
      type: "paymentMethod",
      label: "Payment method",
    },
    {
      id: "footer",
      type: "text",
      align: "center",
      tone: "muted",
      html: "<p>Thank you for your business.</p><p>Questions? Call (386) 631-8982 or email info@generatormaintenancefl.com</p>",
    },
  ];
}
