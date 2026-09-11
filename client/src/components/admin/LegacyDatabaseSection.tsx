"use client";

import { Upload } from "lucide-react";
import JobTerminal from "@/components/admin/JobTerminal";
import {
  detectDumpKindHint,
  LegacyDumpTerminalSession,
  useLegacyDumpTerminal,
} from "@/hooks/useLegacyDumpTerminal";

function CompactDumpDrop({ session }: { session: LegacyDumpTerminalSession }) {
  const {
    files,
    fileError,
    dragActive,
    fileInputRef,
    onFiles,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  } = session;

  return (
    <div className="shrink-0 border-b border-neutral-800 bg-neutral-950 px-3 py-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs ${
          dragActive
            ? "border-brand-orange bg-orange-950/40 text-orange-200"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
        }`}
      >
        <Upload className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {files.length > 0
            ? files
                .map(
                  (file) =>
                    `${file.name} (${detectDumpKindHint(file)})`,
                )
                .join(" · ")
            : "Drop or choose .sql dumps for audit / execute"}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,application/sql,text/plain"
          multiple
          onChange={onFiles}
          className="sr-only"
        />
      </div>
      {fileError && <p className="mt-1 text-[11px] text-red-400">{fileError}</p>}
    </div>
  );
}

export function LegacyDumpTerminalPage({
  token,
  onPopIn,
}: {
  token: string | null;
  onPopIn?: () => void;
}) {
  const session = useLegacyDumpTerminal(token);

  return (
    <div className="flex h-dvh w-full flex-col bg-neutral-950">
      <CompactDumpDrop session={session} />
      <div className="min-h-0 flex-1">
        <JobTerminal
          layout="page"
          lines={session.lines}
          busy={session.jobBusy}
          disabled={!token}
          placeholder="Type help for commands"
          onSubmit={(command) => void session.onTerminalCommand(command)}
          onClear={session.clearLines}
          onPopIn={onPopIn}
        />
      </div>
    </div>
  );
}
