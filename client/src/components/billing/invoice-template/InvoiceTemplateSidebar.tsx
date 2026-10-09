"use client";

import { BLOCK_CATALOG, blockLabel, siblingMeta } from "@/lib/invoice-template";
import type { InvoiceBlock, InvoiceBlockType } from "@/lib/invoice-template";

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange";

function CheckRow({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm text-neutral-700 ${disabled ? "opacity-70" : ""}`}>
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function BlockSettings({
  block,
  onChange,
  uploading,
  uploadError,
  onUploadImage,
}: {
  block: InvoiceBlock;
  onChange: (patch: Record<string, unknown>) => void;
  uploading: boolean;
  uploadError: string | null;
  onUploadImage: (file: File) => void;
}) {
  switch (block.type) {
    case "text":
      return (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">Edit the words on the invoice.</p>
          <label className="block text-sm text-neutral-700">
            Style
            <select
              className={`${inputClass} mt-1`}
              value={block.tone}
              onChange={(event) => onChange({ tone: event.target.value })}
            >
              <option value="body">Body</option>
              <option value="muted">Footer</option>
            </select>
          </label>
          <label className="block text-sm text-neutral-700">
            Alignment
            <select
              className={`${inputClass} mt-1`}
              value={block.align}
              onChange={(event) => onChange({ align: event.target.value })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        </div>
      );
    case "image":
      return (
        <div className="space-y-3">
          <label className="block text-sm text-neutral-700">
            Upload
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="mt-1 block w-full text-sm"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onUploadImage(file);
              }}
            />
          </label>
          {uploading ? <p className="text-xs text-neutral-500">Uploading…</p> : null}
          {uploadError ? <p className="text-xs text-red-700">{uploadError}</p> : null}
          <label className="block text-sm text-neutral-700">
            Image URL
            <input
              className={`${inputClass} mt-1`}
              value={block.url}
              placeholder="https://"
              onChange={(event) => onChange({ url: event.target.value })}
            />
          </label>
          <label className="block text-sm text-neutral-700">
            Alt text
            <input
              className={`${inputClass} mt-1`}
              value={block.alt}
              onChange={(event) => onChange({ alt: event.target.value })}
            />
          </label>
          <label className="block text-sm text-neutral-700">
            Width
            <select
              className={`${inputClass} mt-1`}
              value={block.width}
              onChange={(event) => onChange({ width: event.target.value })}
            >
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label className="block text-sm text-neutral-700">
            Alignment
            <select
              className={`${inputClass} mt-1`}
              value={block.align}
              onChange={(event) => onChange({ align: event.target.value })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        </div>
      );
    case "spacer":
      return (
        <label className="block text-sm text-neutral-700">
          Height ({block.height}px)
          <input
            type="range"
            min={8}
            max={160}
            value={block.height}
            className="mt-2 w-full"
            onChange={(event) => onChange({ height: Number(event.target.value) })}
          />
        </label>
      );
    case "divider":
      return <p className="text-xs text-neutral-500">A horizontal line between sections.</p>;
    case "columns":
      return (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            Content blocks added while this row is selected go in the left column. Use Add text
            inside an empty column to start the other side.
          </p>
          <CheckRow
            label="Divider below"
            checked={block.showDivider}
            onChange={(showDivider) => onChange({ showDivider })}
          />
        </div>
      );
    case "company":
      return (
        <div className="space-y-2">
          <CheckRow label="Name" checked={block.showName} onChange={(showName) => onChange({ showName })} />
          <CheckRow label="Phone" checked={block.showPhone} onChange={(showPhone) => onChange({ showPhone })} />
          <CheckRow label="Email" checked={block.showEmail} onChange={(showEmail) => onChange({ showEmail })} />
          <CheckRow label="License" checked={block.showLicense} onChange={(showLicense) => onChange({ showLicense })} />
        </div>
      );
    case "heading":
      return (
        <div className="space-y-3">
          <label className="block text-sm text-neutral-700">
            Label
            <input
              className={`${inputClass} mt-1`}
              value={block.label}
              onChange={(event) => onChange({ label: event.target.value })}
            />
          </label>
          <CheckRow label="Invoice number" checked={block.showNumber} onChange={(showNumber) => onChange({ showNumber })} />
          <CheckRow label="Source" checked={block.showSource} onChange={(showSource) => onChange({ showSource })} />
        </div>
      );
    case "billTo":
      return (
        <div className="space-y-3">
          <label className="block text-sm text-neutral-700">
            Label
            <input
              className={`${inputClass} mt-1`}
              value={block.label}
              onChange={(event) => onChange({ label: event.target.value })}
            />
          </label>
          <label className="block text-sm text-neutral-700">
            Alignment
            <select
              className={`${inputClass} mt-1`}
              value={block.align}
              onChange={(event) => onChange({ align: event.target.value })}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <CheckRow label="Phone" checked={block.showPhone} onChange={(showPhone) => onChange({ showPhone })} />
          <CheckRow label="Email" checked={block.showEmail} onChange={(showEmail) => onChange({ showEmail })} />
        </div>
      );
    case "meta":
      return (
        <div className="space-y-2">
          <CheckRow label="Issued" checked={block.showIssued} onChange={(showIssued) => onChange({ showIssued })} />
          <CheckRow label="Due" checked={block.showDue} onChange={(showDue) => onChange({ showDue })} />
          <CheckRow label="Status" checked={block.showStatus} onChange={(showStatus) => onChange({ showStatus })} />
          <CheckRow label="Paid" checked={block.showPaid} onChange={(showPaid) => onChange({ showPaid })} />
        </div>
      );
    case "serviceAddress":
    case "notes":
    case "paymentMethod":
      return (
        <label className="block text-sm text-neutral-700">
          Label
          <input
            className={`${inputClass} mt-1`}
            value={block.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>
      );
    case "lineItems":
      return (
        <div className="space-y-3">
          <label className="block text-sm text-neutral-700">
            Description heading
            <input
              className={`${inputClass} mt-1`}
              value={block.descriptionLabel}
              onChange={(event) => onChange({ descriptionLabel: event.target.value })}
            />
          </label>
          <label className="block text-sm text-neutral-700">
            Amount heading
            <input
              className={`${inputClass} mt-1`}
              value={block.amountLabel}
              onChange={(event) => onChange({ amountLabel: event.target.value })}
            />
          </label>
        </div>
      );
    case "totals":
      return (
        <label className="block text-sm text-neutral-700">
          Total label
          <input
            className={`${inputClass} mt-1`}
            value={block.totalLabel}
            onChange={(event) => onChange({ totalLabel: event.target.value })}
          />
        </label>
      );
    default:
      return null;
  }
}

export default function InvoiceTemplateSidebar({
  name,
  isDefault,
  defaultLocked,
  blocks,
  selected,
  uploading,
  uploadError,
  onNameChange,
  onDefaultChange,
  onClearSelection,
  onChangeSelected,
  onMove,
  onDuplicate,
  onDelete,
  onAdd,
  onUploadImage,
}: {
  name: string;
  isDefault: boolean;
  defaultLocked: boolean;
  blocks: InvoiceBlock[];
  selected: InvoiceBlock | null;
  uploading: boolean;
  uploadError: string | null;
  onNameChange: (name: string) => void;
  onDefaultChange: (isDefault: boolean) => void;
  onClearSelection: () => void;
  onChangeSelected: (patch: Record<string, unknown>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAdd: (type: InvoiceBlockType) => void;
  onUploadImage: (file: File) => void;
}) {
  const meta = selected ? siblingMeta(blocks, selected.id) : null;
  const contentBlocks = BLOCK_CATALOG.filter((item) => item.group === "content");
  const invoiceBlocks = BLOCK_CATALOG.filter((item) => item.group === "invoice");

  return (
    <aside className="space-y-5 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      {selected ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-brand-dark">{blockLabel(selected.type)}</h2>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs font-medium text-neutral-500 hover:text-brand-dark"
            >
              Template
            </button>
          </div>
          <BlockSettings
            block={selected}
            onChange={onChangeSelected}
            uploading={uploading}
            uploadError={uploadError}
            onUploadImage={onUploadImage}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!meta || meta.index === 0}
              onClick={() => onMove(-1)}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              Move up
            </button>
            <button
              type="button"
              disabled={!meta || meta.index >= meta.count - 1}
              onClick={() => onMove(1)}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              Move down
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Duplicate
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-brand-dark">Template</h2>
          <label className="block text-sm text-neutral-700">
            Name
            <input
              className={`${inputClass} mt-1`}
              value={name}
              maxLength={80}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <CheckRow
            label="Use as default"
            checked={isDefault}
            disabled={defaultLocked}
            onChange={onDefaultChange}
          />
          {defaultLocked ? (
            <p className="text-xs text-neutral-500">
              This is the invoice customers and staff see. Choose another template to replace it.
            </p>
          ) : null}
        </div>
      )}

      <div className="space-y-3 border-t border-neutral-100 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Add block</h3>
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">Content</p>
          <div className="flex flex-wrap gap-2">
            {contentBlocks.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => onAdd(item.type)}
                className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">Invoice fields</p>
          <div className="flex flex-wrap gap-2">
            {invoiceBlocks.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => onAdd(item.type)}
                className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
