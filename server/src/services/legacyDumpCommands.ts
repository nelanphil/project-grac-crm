import {
  DatabaseInspectTarget,
  DEFAULT_DOCUMENT_LIMIT,
  IDENTIFIER_PATTERN,
  MAX_DOCUMENT_LIMIT,
} from "./databaseInspect";
import { LegacyDumpTarget } from "./legacyDumpSync";

const FORBIDDEN = /\b(drop|delete|remove|destroy|truncate|eval|exec|mongo|shell)\b/i;

export const LEGACY_DUMP_HELP_LINES = [
  "help                              Show this list",
  "health                            Connection status for all configured DBs",
  "targets                           Show configured Mongo hosts",
  "collections [production|development|mysql]  List collections/tables and counts",
  "docs <name> [target] [--limit N] [--skip N]  Peek redacted records",
  "show <name> <id> [target]         One redacted record",
  "counts [production|development]   Read-only customer/work-order counts",
  "audit                             Audit attached SQL dumps (both clusters)",
  "execute development               Import missing records into development",
  "execute production --confirm      Import missing records into production",
  "clear                             Clear the terminal (client only)",
];

const INSPECT_TARGETS: DatabaseInspectTarget[] = [
  "production",
  "development",
  "mysql",
];

function isInspectTarget(value: string): value is DatabaseInspectTarget {
  return INSPECT_TARGETS.includes(value as DatabaseInspectTarget);
}

export type ParsedLegacyDumpCommand =
  | { kind: "help" }
  | { kind: "health" }
  | { kind: "targets" }
  | { kind: "counts"; targets: LegacyDumpTarget[] }
  | { kind: "collections"; targets: DatabaseInspectTarget[] }
  | {
      kind: "docs";
      name: string;
      target: DatabaseInspectTarget;
      limit: number;
      skip: number;
    }
  | {
      kind: "show";
      name: string;
      id: string;
      target: DatabaseInspectTarget;
    }
  | { kind: "audit" }
  | {
      kind: "execute";
      production: boolean;
      development: boolean;
      confirmProduction: boolean;
    }
  | { kind: "rejected"; message: string };

function rejected(message = "Rejected: unknown or forbidden command. Type help."): {
  kind: "rejected";
  message: string;
} {
  return { kind: "rejected", message };
}

export function parseLegacyDumpCommand(raw: string): ParsedLegacyDumpCommand {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return rejected("Rejected: empty command. Type help.");
  }
  if (FORBIDDEN.test(trimmed)) {
    return rejected();
  }

  const tokens = trimmed.split(" ");
  const verb = tokens[0].toLowerCase();

  if (verb === "help") return { kind: "help" };
  if (verb === "health") {
    if (tokens.length > 1) return rejected();
    return { kind: "health" };
  }
  if (verb === "targets") return { kind: "targets" };

  if (verb === "counts") {
    const arg = tokens[1]?.toLowerCase();
    if (tokens.length > 2) return rejected();
    if (!arg || arg === "both") {
      return { kind: "counts", targets: ["production", "development"] };
    }
    if (arg === "production" || arg === "development") {
      return { kind: "counts", targets: [arg] };
    }
    return rejected();
  }

  if (verb === "collections") {
    const arg = tokens[1]?.toLowerCase();
    if (tokens.length > 2) return rejected();
    if (!arg || arg === "both" || arg === "all") {
      return { kind: "collections", targets: [...INSPECT_TARGETS] };
    }
    if (isInspectTarget(arg)) {
      return { kind: "collections", targets: [arg] };
    }
    return rejected();
  }

  if (verb === "docs") {
    const name = tokens[1];
    if (!name || !IDENTIFIER_PATTERN.test(name)) {
      return rejected("Rejected: docs requires a collection or table name. Type help.");
    }
    let target: DatabaseInspectTarget = "development";
    let limit = DEFAULT_DOCUMENT_LIMIT;
    let skip = 0;
    let i = 2;
    while (i < tokens.length) {
      const token = tokens[i].toLowerCase();
      if (isInspectTarget(token)) {
        target = token;
        i += 1;
        continue;
      }
      if (token === "--limit") {
        const n = Number(tokens[i + 1]);
        if (!Number.isInteger(n) || n < 1) {
          return rejected("Rejected: --limit must be a positive integer. Type help.");
        }
        limit = Math.min(n, MAX_DOCUMENT_LIMIT);
        i += 2;
        continue;
      }
      if (token === "--skip") {
        const n = Number(tokens[i + 1]);
        if (!Number.isInteger(n) || n < 0) {
          return rejected("Rejected: --skip must be a non-negative integer. Type help.");
        }
        skip = n;
        i += 2;
        continue;
      }
      return rejected();
    }
    return { kind: "docs", name, target, limit, skip };
  }

  if (verb === "show") {
    const name = tokens[1];
    const id = tokens[2];
    const targetArg = tokens[3]?.toLowerCase();
    if (!name || !id || !IDENTIFIER_PATTERN.test(name)) {
      return rejected("Rejected: show requires a name and id. Type help.");
    }
    if (tokens.length > 4) return rejected();
    let target: DatabaseInspectTarget = "development";
    if (targetArg) {
      if (!isInspectTarget(targetArg)) return rejected();
      target = targetArg;
    }
    return { kind: "show", name, id, target };
  }

  if (verb === "audit") {
    if (tokens.length > 1) return rejected();
    return { kind: "audit" };
  }

  if (verb === "execute") {
    const rest = tokens.slice(1).map((token) => token.toLowerCase());
    if (rest[0] === "development" && rest.length === 1) {
      return {
        kind: "execute",
        production: false,
        development: true,
        confirmProduction: false,
      };
    }
    if (rest[0] === "production" && rest[1] === "--confirm" && rest.length === 2) {
      return {
        kind: "execute",
        production: true,
        development: false,
        confirmProduction: true,
      };
    }
    if (rest[0] === "production") {
      return rejected(
        "Rejected: execute production requires --confirm. Type help.",
      );
    }
    return rejected();
  }

  if (verb === "clear") {
    return {
      kind: "rejected",
      message: "clear is handled in the terminal, not the server.",
    };
  }

  return rejected();
}
