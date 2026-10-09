"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import {
  InvoiceBlockBody,
  InvoiceColumnsFrame,
  invoiceArticleClass,
} from "@/components/billing/InvoiceLayout";
import InvoiceTextEditor from "@/components/billing/invoice-template/InvoiceTextEditor";
import type { InvoiceItem } from "@/lib/api";
import type { InvoiceBlock, InvoiceLeafBlock } from "@/lib/invoice-template";

function SortableShell({
  id,
  selected,
  onSelect,
  children,
}: {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-invoice-block={id}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(id);
      }}
      className={`relative rounded-md ${
        selected ? "ring-2 ring-brand-orange" : "hover:ring-1 hover:ring-neutral-300"
      }`}
    >
      <button
        type="button"
        className="absolute left-0 top-0 z-10 cursor-grab rounded p-0.5 text-neutral-400 hover:text-brand-dark"
        aria-label="Reorder block"
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="pl-5">{children}</div>
    </div>
  );
}

function EditableLeaf({
  block,
  invoice,
  selectedId,
  onSelect,
  onTextChange,
}: {
  block: InvoiceLeafBlock;
  invoice: InvoiceItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTextChange: (id: string, html: string) => void;
}) {
  return (
    <SortableShell id={block.id} selected={selectedId === block.id} onSelect={onSelect}>
      <InvoiceBlockBody
        block={block}
        invoice={invoice}
        isCustomer={false}
        editing
        textEditor={
          block.type === "text" && selectedId === block.id ? (
            <InvoiceTextEditor
              value={block.html}
              onChange={(html) => onTextChange(block.id, html)}
            />
          ) : undefined
        }
      />
    </SortableShell>
  );
}

function ColumnList({
  columnId,
  side,
  blocks,
  invoice,
  selectedId,
  onSelect,
  onTextChange,
  onAddText,
}: {
  columnId: string;
  side: "left" | "right";
  blocks: InvoiceLeafBlock[];
  invoice: InvoiceItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTextChange: (id: string, html: string) => void;
  onAddText: (columnId: string, side: "left" | "right") => void;
}) {
  if (blocks.length === 0) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAddText(columnId, side);
        }}
        className="w-full rounded-md border border-dashed border-neutral-300 px-3 py-6 text-sm text-neutral-500 hover:border-brand-orange hover:text-brand-dark"
      >
        Add text
      </button>
    );
  }

  return (
    <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
      <div className="space-y-5">
        {blocks.map((block) => (
          <EditableLeaf
            key={block.id}
            block={block}
            invoice={invoice}
            selectedId={selectedId}
            onSelect={onSelect}
            onTextChange={onTextChange}
          />
        ))}
      </div>
    </SortableContext>
  );
}

export default function InvoiceTemplateCanvas({
  blocks,
  invoice,
  selectedId,
  onSelect,
  onTextChange,
  onReorder,
  onAddText,
}: {
  blocks: InvoiceBlock[];
  invoice: InvoiceItem;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTextChange: (id: string, html: string) => void;
  onReorder: (activeId: string, overId: string) => void;
  onAddText: (columnId: string, side: "left" | "right") => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    onReorder(String(event.active.id), String(overId));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <article
        className={`${invoiceArticleClass(false)} min-h-[720px]`}
        onClick={() => onSelect(null)}
      >
        <SortableContext
          items={blocks.map((block) => block.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-6">
            {blocks.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Add a block from the sidebar to start this invoice.
              </p>
            ) : null}
            {blocks.map((block) =>
              block.type === "columns" ? (
                <SortableShell
                  key={block.id}
                  id={block.id}
                  selected={selectedId === block.id}
                  onSelect={(id) => onSelect(id)}
                >
                  <InvoiceColumnsFrame
                    block={block}
                    left={
                      <ColumnList
                        columnId={block.id}
                        side="left"
                        blocks={block.left}
                        invoice={invoice}
                        selectedId={selectedId}
                        onSelect={(id) => onSelect(id)}
                        onTextChange={onTextChange}
                        onAddText={onAddText}
                      />
                    }
                    right={
                      <ColumnList
                        columnId={block.id}
                        side="right"
                        blocks={block.right}
                        invoice={invoice}
                        selectedId={selectedId}
                        onSelect={(id) => onSelect(id)}
                        onTextChange={onTextChange}
                        onAddText={onAddText}
                      />
                    }
                  />
                </SortableShell>
              ) : (
                <EditableLeaf
                  key={block.id}
                  block={block}
                  invoice={invoice}
                  selectedId={selectedId}
                  onSelect={(id) => onSelect(id)}
                  onTextChange={onTextChange}
                />
              ),
            )}
          </div>
        </SortableContext>
      </article>
    </DndContext>
  );
}
