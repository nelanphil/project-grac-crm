"use client";

import { useEffect, useRef, useState } from "react";
import { InboxConversationItem } from "@/lib/api";
import {
  Ban,
  Check,
  Copy,
  Link,
  MailOpen,
  Phone,
  Pin,
  SquareCheck,
  Trash2,
} from "lucide-react";

export type ConversationMenuAction =
  | "call"
  | "done"
  | "unread"
  | "task"
  | "pin"
  | "link"
  | "markdown"
  | "block"
  | "delete";

type MenuEntry = {
  action: ConversationMenuAction;
  label: string;
  icon: typeof Phone;
  danger?: boolean;
  divider?: boolean;
};

function shortName(item: InboxConversationItem): string {
  const first = (item.displayName || "").trim().split(/\s+/)[0] || "";
  if (!first || /[\d(+@]/.test(first)) return "";
  return first;
}

function entries(
  item: InboxConversationItem,
  canWrite: boolean,
  canTasks: boolean,
): MenuEntry[] {
  const name = shortName(item);
  const rows: MenuEntry[] = [];
  if (canWrite && item.phone) {
    rows.push({ action: "call", label: name ? `Call ${name}` : "Call", icon: Phone });
  }
  if (canWrite) {
    rows.push({
      action: "done",
      label: item.status === "closed" ? "Mark as open" : "Mark as done",
      icon: Check,
    });
    rows.push({ action: "unread", label: "Mark as unread", icon: MailOpen });
  }
  if (canTasks) {
    rows.push({ action: "task", label: "Create new task", icon: SquareCheck });
  }
  if (canWrite) {
    rows.push({
      action: "pin",
      label: item.pinned ? "Unpin conversation" : "Pin conversation",
      icon: Pin,
    });
  }
  rows.push({ action: "link", label: "Copy link", icon: Link });
  rows.push({ action: "markdown", label: "Copy as markdown", icon: Copy });
  if (canWrite) {
    rows.push({
      action: "block",
      label: item.blocked
        ? name
          ? `Unblock ${name}`
          : "Unblock"
        : name
          ? `Block ${name}`
          : "Block",
      icon: Ban,
      divider: true,
    });
    rows.push({ action: "delete", label: "Delete conversation", icon: Trash2, danger: true });
  }
  return rows;
}

type ConversationContextMenuProps = {
  x: number;
  y: number;
  item: InboxConversationItem;
  canWrite: boolean;
  canTasks: boolean;
  onAction: (action: ConversationMenuAction) => void;
  onClose: () => void;
};

export default function ConversationContextMenu({
  x,
  y,
  item,
  canWrite,
  canTasks,
  onAction,
  onClose,
}: ConversationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState({ x, y });

  useEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPoint({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y, item.id]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const rows = entries(item, canWrite, canTasks);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ top: point.y, left: point.x }}
      className="fixed z-50 w-56 overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] py-1 shadow-lg"
    >
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <div key={row.action}>
            {row.divider ? <div className="my-1 border-t border-[var(--staff-border)]" /> : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => onAction(row.action)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--staff-cream)] ${
                row.danger ? "text-red-500" : "text-[var(--staff-ink)]"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {row.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
