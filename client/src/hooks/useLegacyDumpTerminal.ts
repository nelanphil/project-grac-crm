"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  JobTerminalLevel,
  JobTerminalLine,
} from "@/components/admin/JobTerminal";
import {
  ApiError,
  getLegacyDumpTargets,
  LegacyDumpResponse,
  streamLegacyDumpAudit,
  streamLegacyDumpCommand,
  streamLegacyDumpExecute,
} from "@/lib/api";

export const MAX_DUMP_FILES = 2;
export const MAX_DUMP_BYTES = 10 * 1024 * 1024;

export function detectDumpKindHint(file: File): string {
  const name = file.name.toLowerCase();
  if (name.includes("customer")) return "customers";
  if (name.includes("work_order") || name.includes("work-order")) {
    return "work_orders";
  }
  return "unknown";
}

function isDumpResponse(data: unknown): data is LegacyDumpResponse {
  return Boolean(
    data && typeof data === "object" && "targets" in data && "files" in data,
  );
}

export function useLegacyDumpTerminal(token: string | null) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [commandRunning, setCommandRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<LegacyDumpResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<LegacyDumpResponse | null>(
    null,
  );
  const [runProduction, setRunProduction] = useState(true);
  const [runDevelopment, setRunDevelopment] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [targets, setTargets] = useState<LegacyDumpResponse["targets"] | null>(
    null,
  );
  const [dragActive, setDragActive] = useState(false);
  const [lines, setLines] = useState<JobTerminalLine[]>(() => [
    {
      id: "welcome",
      ts: new Date().toISOString(),
      level: "info",
      text: "Type help for commands. Destructive operations (drop/delete) are blocked.",
    },
  ]);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lineId = useRef(1);

  const appendLine = useCallback(
    (text: string, level: JobTerminalLevel = "info", ts?: string) => {
      lineId.current += 1;
      setLines((prev) => [
        ...prev,
        {
          id: `l${lineId.current}`,
          ts: ts ?? new Date().toISOString(),
          level,
          text,
        },
      ]);
    },
    [],
  );

  const onDumpLog = useCallback(
    (message: string, level: string, ts: string) => {
      const allowed: JobTerminalLevel[] = ["info", "warn", "error", "ok", "cmd"];
      appendLine(
        message,
        allowed.includes(level as JobTerminalLevel)
          ? (level as JobTerminalLevel)
          : "info",
        ts,
      );
    },
    [appendLine],
  );

  const applyAuditResult = useCallback((result: LegacyDumpResponse) => {
    setAudit(result);
    setTargets(result.targets);
    if (
      !result.targets.production.available ||
      result.errors?.production ||
      !result.production
    ) {
      setRunProduction(false);
    }
    if (
      !result.targets.development.available ||
      result.errors?.development ||
      !result.development
    ) {
      setRunDevelopment(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getLegacyDumpTargets(token)
      .then((res) => {
        if (!cancelled) setTargets(res.targets);
      })
      .catch(() => {
        /* audit response also includes targets */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const selectedTargets = useMemo(
    () => targets ?? audit?.targets ?? null,
    [targets, audit],
  );

  const applyFiles = useCallback((next: File[]) => {
    setFileError(null);
    setAudit(null);
    setExecuteResult(null);
    setConfirmOpen(false);
    if (next.length === 0) {
      setFiles([]);
      return;
    }
    if (next.length > MAX_DUMP_FILES) {
      setFileError("Choose at most two SQL files.");
      setFiles([]);
      return;
    }
    const oversized = next.find((f) => f.size > MAX_DUMP_BYTES);
    if (oversized) {
      setFileError("Each file must be 10 MB or smaller.");
      setFiles([]);
      return;
    }
    const notSql = next.find((f) => !f.name.toLowerCase().endsWith(".sql"));
    if (notSql) {
      setFileError("Only .sql dumps are accepted.");
      setFiles([]);
      return;
    }
    setFiles(next);
  }, []);

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    applyFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDragActive(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    applyFiles(Array.from(e.dataTransfer.files ?? []));
  }

  async function runAudit() {
    if (!token || files.length === 0) {
      setFileError("Choose one or two .sql dumps first.");
      return;
    }
    setAuditing(true);
    setError(null);
    setExecuteResult(null);
    appendLine("audit", "cmd");
    try {
      const result = await streamLegacyDumpAudit(token, files, onDumpLog);
      applyAuditResult(result);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Audit failed. Try again.";
      setError(message);
      appendLine(message, "error");
    } finally {
      setAuditing(false);
    }
  }

  const jobBusy = auditing || executing || commandRunning;
  const canExecute =
    Boolean(audit) &&
    ((runProduction && Boolean(audit?.production)) ||
      (runDevelopment && Boolean(audit?.development))) &&
    !jobBusy &&
    Boolean(token);

  function requestExecute() {
    setError(null);
    if (runProduction) {
      setConfirmOpen(true);
      return;
    }
    void doExecute(false);
  }

  async function doExecute(confirmProduction: boolean) {
    if (!token) return;
    setConfirmOpen(false);
    setExecuting(true);
    setError(null);
    appendLine(
      runProduction ? "execute production --confirm" : "execute development",
      "cmd",
    );
    try {
      const result = await streamLegacyDumpExecute(
        token,
        files,
        {
          production: runProduction,
          development: runDevelopment,
          confirmProduction,
        },
        onDumpLog,
      );
      setExecuteResult(result);
      setAudit((prev) => ({
        files: result.files,
        targets: result.targets,
        production: result.production ?? prev?.production,
        development: result.development ?? prev?.development,
        errors: result.errors ?? prev?.errors,
      }));
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Import failed. Try again.";
      setError(message);
      appendLine(message, "error");
    } finally {
      setExecuting(false);
    }
  }

  async function onTerminalCommand(command: string) {
    const trimmed = command.trim();
    appendLine(trimmed, "cmd");
    if (trimmed.toLowerCase() === "clear") {
      setLines([]);
      return;
    }
    if (!token) {
      appendLine("Not signed in.", "error");
      return;
    }
    setCommandRunning(true);
    setError(null);
    try {
      const result = await streamLegacyDumpCommand(
        token,
        trimmed,
        files,
        onDumpLog,
      );
      if (isDumpResponse(result)) {
        if (
          result.production?.mode === "import" ||
          result.development?.mode === "import"
        ) {
          setExecuteResult(result);
          setAudit((prev) => ({
            files: result.files,
            targets: result.targets,
            production: result.production ?? prev?.production,
            development: result.development ?? prev?.development,
            errors: result.errors ?? prev?.errors,
          }));
        } else {
          applyAuditResult(result);
        }
      }
    } catch (err) {
      appendLine(
        err instanceof ApiError ? err.message : "Command failed.",
        "error",
      );
    } finally {
      setCommandRunning(false);
    }
  }

  return {
    token,
    files,
    fileError,
    dragActive,
    error,
    audit,
    executeResult,
    runProduction,
    runDevelopment,
    confirmOpen,
    selectedTargets,
    lines,
    jobBusy,
    auditing,
    executing,
    canExecute,
    productionCounts: audit?.production?.audit,
    fileInputRef,
    setRunProduction,
    setRunDevelopment,
    setConfirmOpen,
    applyFiles,
    onFiles,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    runAudit,
    requestExecute,
    doExecute,
    onTerminalCommand,
    clearLines: () => setLines([]),
  };
}

export type LegacyDumpTerminalSession = ReturnType<typeof useLegacyDumpTerminal>;
