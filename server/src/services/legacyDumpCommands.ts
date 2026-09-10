import { LegacyDumpTarget } from "./legacyDumpSync";

const FORBIDDEN = /\b(drop|delete|remove|destroy|truncate|eval|exec|mongo|shell)\b/i;

export const LEGACY_DUMP_HELP_LINES = [
  "help                              Show this list",
  "targets                           Show configured Mongo hosts",
  "counts [production|development]   Read-only document counts",
  "audit                             Audit attached SQL dumps (both clusters)",
  "execute development               Import missing records into development",
  "execute production --confirm      Import missing records into production",
  "clear                             Clear the terminal (client only)",
];

export type ParsedLegacyDumpCommand =
  | { kind: "help" }
  | { kind: "targets" }
  | { kind: "counts"; targets: LegacyDumpTarget[] }
  | { kind: "audit" }
  | {
      kind: "execute";
      production: boolean;
      development: boolean;
      confirmProduction: boolean;
    }
  | { kind: "rejected"; message: string };

export function parseLegacyDumpCommand(raw: string): ParsedLegacyDumpCommand {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { kind: "rejected", message: "Rejected: empty command. Type help." };
  }
  if (FORBIDDEN.test(trimmed)) {
    return {
      kind: "rejected",
      message: "Rejected: unknown or forbidden command. Type help.",
    };
  }

  const tokens = trimmed.toLowerCase().split(" ");
  const verb = tokens[0];

  if (verb === "help") return { kind: "help" };
  if (verb === "targets") return { kind: "targets" };

  if (verb === "counts") {
    const arg = tokens[1];
    if (tokens.length > 2) {
      return {
        kind: "rejected",
        message: "Rejected: unknown or forbidden command. Type help.",
      };
    }
    if (!arg || arg === "both") {
      return { kind: "counts", targets: ["production", "development"] };
    }
    if (arg === "production" || arg === "development") {
      return { kind: "counts", targets: [arg] };
    }
    return {
      kind: "rejected",
      message: "Rejected: unknown or forbidden command. Type help.",
    };
  }

  if (verb === "audit") {
    if (tokens.length > 1) {
      return {
        kind: "rejected",
        message: "Rejected: unknown or forbidden command. Type help.",
      };
    }
    return { kind: "audit" };
  }

  if (verb === "execute") {
    const rest = tokens.slice(1);
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
      return {
        kind: "rejected",
        message:
          "Rejected: execute production requires --confirm. Type help.",
      };
    }
    return {
      kind: "rejected",
      message: "Rejected: unknown or forbidden command. Type help.",
    };
  }

  if (verb === "clear") {
    return {
      kind: "rejected",
      message: "clear is handled in the terminal, not the server.",
    };
  }

  return {
    kind: "rejected",
    message: "Rejected: unknown or forbidden command. Type help.",
  };
}
