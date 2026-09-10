"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { createRoot, Root } from "react-dom/client";
import {
  Copy,
  Eraser,
  Maximize2,
  Minimize2,
  SquareArrowDownLeft,
  SquareArrowOutUpRight,
  TerminalSquare,
} from "lucide-react";
import { openFloatingTerminalWindow } from "@/utils/jobTerminalWindow";

export type JobTerminalLevel = "info" | "warn" | "error" | "ok" | "cmd";

export type JobTerminalLine = {
  id: string;
  ts: string;
  level: JobTerminalLevel;
  text: string;
};

const LEVEL_CLASS: Record<JobTerminalLevel, string> = {
  info: "text-neutral-200",
  warn: "text-amber-300",
  error: "text-red-400",
  ok: "text-emerald-400",
  cmd: "text-sky-300",
};

function formatClock(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function TerminalPanel({
  lines,
  busy,
  disabled,
  placeholder,
  fillViewport,
  expanded,
  poppedOut,
  isPage,
  copied,
  draft,
  scrollerRef,
  inputRef,
  onCopy,
  onClear,
  onToggleExpand,
  onPopOut,
  onPopIn,
  onFormSubmit,
  onDraftChange,
  onKeyDown,
}: {
  lines: JobTerminalLine[];
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  fillViewport: boolean;
  expanded: boolean;
  poppedOut: boolean;
  isPage: boolean;
  copied: boolean;
  draft: string;
  scrollerRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  onCopy: () => void;
  onClear: () => void;
  onToggleExpand: () => void;
  onPopOut: () => void;
  onPopIn: () => void;
  onFormSubmit: (e: FormEvent) => void;
  onDraftChange: (value: string) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden border border-neutral-800 bg-neutral-950 ${
        fillViewport ? "w-full rounded-none" : "rounded-lg"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-neutral-300">
          <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          Backend terminal
          {busy && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
              running
            </span>
          )}
          {expanded && !poppedOut && (
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              Esc to exit
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
          {!isPage && !poppedOut && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              {expanded ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
              {expanded ? "Exit" : "Expand"}
            </button>
          )}
          {!isPage && !poppedOut && (
            <button
              type="button"
              onClick={onPopOut}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <SquareArrowOutUpRight className="h-3 w-3" />
              Pop out
            </button>
          )}
          {(poppedOut || isPage) && (
            <button
              type="button"
              onClick={onPopIn}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <SquareArrowDownLeft className="h-3 w-3" />
              Pop in
            </button>
          )}
        </div>
      </div>
      <div
        ref={scrollerRef}
        onClick={() => inputRef.current?.focus()}
        className={`min-h-40 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-5 ${
          fillViewport ? "min-h-0 flex-1" : "max-h-72"
        }`}
      >
        {lines.length === 0 ? (
          <p className="text-neutral-500">No output yet.</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="flex gap-2">
              <span className="shrink-0 text-neutral-500">
                {formatClock(line.ts)}
              </span>
              <span
                className={`whitespace-pre-wrap break-all ${LEVEL_CLASS[line.level]}`}
              >
                {line.level === "cmd" ? `$ ${line.text}` : line.text}
              </span>
            </div>
          ))
        )}
        {busy && <p className="animate-pulse text-neutral-500">…</p>}
      </div>
      <form
        onSubmit={onFormSubmit}
        className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2"
      >
        <span className="font-mono text-xs text-sky-300">$</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || busy}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-neutral-100 outline-none placeholder:text-neutral-600 disabled:opacity-50"
        />
      </form>
    </div>
  );
}

export default function JobTerminal({
  lines,
  busy = false,
  disabled = false,
  placeholder = "Type help for commands",
  layout = "inline",
  onSubmit,
  onClear,
  onPopIn,
}: {
  lines: JobTerminalLine[];
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  layout?: "inline" | "page";
  onSubmit: (command: string) => void;
  onClear: () => void;
  onPopIn?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>([]);
  const floatRootRef = useRef<Root | null>(null);
  const floatWindowRef = useRef<Window | null>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [poppedOut, setPoppedOut] = useState(false);
  const [popoutBlocked, setPopoutBlocked] = useState(false);

  const isPage = layout === "page";
  const fillViewport = isPage || expanded || poppedOut;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, busy, fillViewport, poppedOut]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  function teardownFloat(closeWindow: boolean) {
    const root = floatRootRef.current;
    const win = floatWindowRef.current;
    floatRootRef.current = null;
    floatWindowRef.current = null;
    try {
      root?.unmount();
    } catch {
      /* window already gone */
    }
    if (closeWindow && win && !win.closed) {
      try {
        win.close();
      } catch {
        /* ignore */
      }
    }
  }

  function dock(closeWindow: boolean) {
    teardownFloat(closeWindow);
    setPoppedOut(false);
  }

  useEffect(() => {
    const win = floatWindowRef.current;
    if (!win || !poppedOut) return;
    const onHide = () => {
      teardownFloat(false);
      setPoppedOut(false);
    };
    win.addEventListener("pagehide", onHide);
    return () => {
      win.removeEventListener("pagehide", onHide);
    };
  }, [poppedOut]);

  useEffect(() => {
    return () => {
      teardownFloat(true);
    };
  }, []);

  async function copyLog() {
    const text = lines
      .map((line) => `${formatClock(line.ts)} ${line.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function popOut() {
    const existing = floatWindowRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const opened = await openFloatingTerminalWindow();
    if (!opened) {
      setPopoutBlocked(true);
      return;
    }
    setPopoutBlocked(false);
    const mount = opened.document.createElement("div");
    mount.id = "job-terminal-mount";
    mount.style.height = "100%";
    mount.style.display = "flex";
    mount.style.flexDirection = "column";
    opened.document.body.replaceChildren(mount);
    floatRootRef.current = createRoot(mount);
    floatWindowRef.current = opened;
    setExpanded(false);
    setPoppedOut(true);
  }

  function popIn() {
    dock(true);
    onPopIn?.();
  }

  function submitDraft() {
    const command = draft.trim();
    if (!command || busy || disabled) return;
    historyRef.current = [
      ...historyRef.current.filter((item) => item !== command),
      command,
    ];
    setHistoryIndex(-1);
    setDraft("");
    onSubmit(command);
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    submitDraft();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const history = historyRef.current;
      if (history.length === 0) return;
      const next =
        historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setDraft(history[next] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const history = historyRef.current;
      if (historyIndex < 0) return;
      if (historyIndex >= history.length - 1) {
        setHistoryIndex(-1);
        setDraft("");
        return;
      }
      const next = historyIndex + 1;
      setHistoryIndex(next);
      setDraft(history[next] ?? "");
    }
  }

  const panel = (
    <TerminalPanel
      lines={lines}
      busy={busy}
      disabled={disabled}
      placeholder={placeholder}
      fillViewport={fillViewport}
      expanded={expanded}
      poppedOut={poppedOut}
      isPage={isPage}
      copied={copied}
      draft={draft}
      scrollerRef={scrollerRef}
      inputRef={inputRef}
      onCopy={() => void copyLog()}
      onClear={onClear}
      onToggleExpand={() => setExpanded((v) => !v)}
      onPopOut={() => void popOut()}
      onPopIn={popIn}
      onFormSubmit={onFormSubmit}
      onDraftChange={(value) => {
        setDraft(value);
        setHistoryIndex(-1);
      }}
      onKeyDown={onKeyDown}
    />
  );

  useLayoutEffect(() => {
    if (!poppedOut) return;
    floatRootRef.current?.render(panel);
  });

  if (poppedOut) {
    return (
      <div className="flex h-24 items-center justify-between gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 text-sm text-neutral-600">
        <span>Terminal is in its own window.</span>
        <button
          type="button"
          onClick={popIn}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          <SquareArrowDownLeft className="h-3 w-3" />
          Pop back in
        </button>
      </div>
    );
  }

  if (expanded && mounted) {
    return (
      <>
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500">
          Terminal expanded — press Esc to restore
        </div>
        {createPortal(
          <div className="fixed inset-0 z-[200] bg-neutral-950">{panel}</div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <>
      {popoutBlocked && (
        <p className="mb-2 text-xs text-amber-700">
          The browser blocked the terminal window. Allow pop-ups for this site
          and try Pop out again.
        </p>
      )}
      {panel}
    </>
  );
}
