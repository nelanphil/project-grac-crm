"use client";

import { useRouter, useSearchParams } from "next/navigation";
import JobTerminal from "@/components/admin/JobTerminal";
import LegacyDatabaseUploadCard from "@/components/admin/LegacyDatabaseUploadCard";
import DatabaseHealthSection from "@/components/admin/DatabaseHealthSection";
import { useLegacyDumpTerminal } from "@/hooks/useLegacyDumpTerminal";

type DatabaseChildId = "legacy" | "health";

const CHILDREN: { id: DatabaseChildId; label: string }[] = [
  { id: "legacy", label: "Legacy" },
  { id: "health", label: "Health" },
];

function parseChild(value: string | null): DatabaseChildId {
  return value === "legacy" ? "legacy" : "health";
}

export default function DatabaseSection({
  token,
}: {
  token: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const child = parseChild(searchParams.get("section"));
  const session = useLegacyDumpTerminal(token);

  function setChild(id: DatabaseChildId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "database");
    params.set("section", id);
    if (id !== "health") {
      params.delete("target");
      params.delete("collection");
    }
    router.replace(`/dashboard/admin?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <JobTerminal
        lines={session.lines}
        busy={session.jobBusy}
        disabled={!token}
        placeholder="Type help for commands"
        onSubmit={(command) => void session.onTerminalCommand(command)}
        onClear={session.clearLines}
      />

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-neutral-200">
        {CHILDREN.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setChild(item.id)}
            className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
              child === item.id
                ? "border-brand-orange text-brand-dark"
                : "border-transparent text-neutral-500 hover:text-brand-dark"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {child === "legacy" && <LegacyDatabaseUploadCard session={session} />}
      {child === "health" && <DatabaseHealthSection token={token} />}
    </div>
  );
}
