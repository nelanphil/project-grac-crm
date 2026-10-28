"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Loader2, type LucideIcon } from "lucide-react";

export type ActionsMenuItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Short note under the label, e.g. why the action is unavailable. */
  hint?: string | null;
  /** Items with the same group are listed together, separated by a divider. */
  group?: string;
  active?: boolean;
};

type Props = {
  items: ActionsMenuItem[];
  label?: string;
  /** Replaces the label and shows a spinner while an action is running. */
  busyLabel?: string | null;
  className?: string;
};

export default function ActionsMenu({
  items,
  label = "Actions",
  busyLabel,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (items.length === 0) return null;

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function moveFocus(step: 1 | -1) {
    const enabled = itemRefs.current.filter(
      (item): item is HTMLButtonElement => Boolean(item && !item.disabled),
    );
    if (enabled.length === 0) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = index === -1 ? 0 : (index + step + enabled.length) % enabled.length;
    enabled[next]?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  return (
    <div ref={wrapperRef} className={`relative print:hidden ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 sm:w-auto"
      >
        {busyLabel ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {busyLabel || label}
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-40 mt-1 max-h-[70vh] w-full min-w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 text-brand-dark shadow-lg sm:w-72"
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            const newGroup = index > 0 && items[index - 1]?.group !== item.group;
            return (
              <div key={item.key}>
                {newGroup ? <div className="my-1 border-t border-neutral-100" /> : null}
                <button
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                  className={`flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-neutral-50 focus-visible:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                    item.active ? "bg-orange-50" : ""
                  }`}
                >
                  {Icon ? (
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block font-medium">{item.label}</span>
                    {item.hint ? (
                      <span className="block text-xs text-neutral-500">{item.hint}</span>
                    ) : null}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
