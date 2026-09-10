import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  LEGACY_DUMP_HELP_LINES,
  parseLegacyDumpCommand,
} from "../services/legacyDumpCommands";
import {
  countLegacyDumpCollections,
  describeLegacyDumpTargets,
  describeMongoTarget,
  detectDumpKind,
  LegacyDumpTarget,
  LegacyDumpSyncResult,
  runLegacyDumpSync,
  resolveLegacyDumpUri,
} from "../services/legacyDumpSync";
import {
  endSse,
  initSse,
  sendSse,
  sseLog,
  SseLevel,
  wantsSse,
} from "../utils/sse";

const MAX_FILES = 2;
let executeInFlight = false;

type ClassifiedDump = {
  customerSql?: string;
  workOrderSql?: string;
  files: Array<{ filename: string; kind: "customers" | "work_orders" }>;
};

type DumpJobResult = {
  files: ClassifiedDump["files"];
  targets: ReturnType<typeof describeLegacyDumpTargets>;
  production?: LegacyDumpSyncResult;
  development?: LegacyDumpSyncResult;
  errors?: Partial<Record<LegacyDumpTarget, string>>;
};

type LogFn = (message: string, level?: SseLevel) => void;

function classifyUploads(
  files: Express.Multer.File[] | undefined,
): ClassifiedDump | { error: string } {
  if (!files || files.length === 0) {
    return { error: "Upload at least one .sql dump." };
  }
  if (files.length > MAX_FILES) {
    return { error: "Upload at most two SQL files (customers and work_orders)." };
  }

  const classified: ClassifiedDump = { files: [] };
  for (const file of files) {
    const sql = file.buffer.toString("utf-8");
    const kind = detectDumpKind(sql, file.originalname);
    if (!kind) {
      return {
        error: `Could not detect customers or work_orders table in ${file.originalname || "upload"}.`,
      };
    }
    if (kind === "customers") {
      if (classified.customerSql) {
        return { error: "Upload only one customers dump." };
      }
      classified.customerSql = sql;
    } else {
      if (classified.workOrderSql) {
        return { error: "Upload only one work_orders dump." };
      }
      classified.workOrderSql = sql;
    }
    classified.files.push({ filename: file.originalname || kind, kind });
  }
  return classified;
}

function parseBool(value: unknown): boolean {
  if (value === true || value === "true" || value === "1" || value === "on") return true;
  return false;
}

function actorLabel(req: AuthRequest): string {
  return req.user?.email || req.user?.id || "unknown";
}

function disableTimeouts(req: AuthRequest, res: Response): void {
  req.setTimeout(0);
  res.setTimeout(0);
  req.socket?.setTimeout(0);
}

function jsonOrStreamError(
  _req: AuthRequest,
  res: Response,
  status: number,
  message: string,
): void {
  if (res.headersSent) {
    sseLog(res, message, "error");
    sendSse(res, "error", { message });
    endSse(res);
    return;
  }
  res.status(status).json({ message });
}

async function runDumpJobs(options: {
  classified: ClassifiedDump;
  mode: "audit" | "import";
  selected: LegacyDumpTarget[];
  actor: string;
  onLog: LogFn;
}): Promise<{ result: DumpJobResult; succeeded: boolean }> {
  const { classified, mode, selected, actor, onLog } = options;
  const targets = describeLegacyDumpTargets();
  const result: DumpJobResult = { files: classified.files, targets };
  const errors: Partial<Record<LegacyDumpTarget, string>> = {};

  for (const name of selected) {
    const uri = resolveLegacyDumpUri(name);
    if (!uri) {
      const message =
        name === "production"
          ? "MONGODB_URI_PRODUCTION is not set"
          : "MONGODB_URI_DEVELOPMENT is not set";
      errors[name] = message;
      onLog(`${name}: ${message}`, "error");
      continue;
    }
    onLog(
      `Starting ${mode} on ${name} (${describeMongoTarget(uri)})…`,
    );
    try {
      const report = await runLegacyDumpSync({
        customerSql: classified.customerSql,
        workOrderSql: classified.workOrderSql,
        mongoUri: uri,
        mode,
        target: name,
        onLog: (message) => onLog(message),
      });
      result[name] = report;
      onLog(`Finished ${mode} on ${name}.`, "ok");
      if (mode === "import") {
        console.log("[legacy-dump] execute", {
          actor,
          target: name,
          host: report.targetLabel,
          customersInserted: report.summary.customersInserted,
          workOrdersInserted: report.summary.workOrdersInserted,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `${mode} failed.`;
      errors[name] = message;
      onLog(`${name}: ${message}`, "error");
      console.error(`[legacy-dump] ${mode} failed`, {
        actor,
        target: name,
        message,
      });
    }
  }

  if (Object.keys(errors).length > 0) {
    result.errors = errors;
  }
  const succeeded = selected.some((name) => result[name] != null);
  return { result, succeeded };
}

function finishDumpResponse(
  req: AuthRequest,
  res: Response,
  stream: boolean,
  result: DumpJobResult,
  succeeded: boolean,
  failMessage: string,
): void {
  if (stream) {
    if (!succeeded) {
      sseLog(res, failMessage, "error");
      sendSse(res, "error", { message: failMessage });
    }
    sendSse(res, "result", result);
    endSse(res);
    return;
  }
  if (!succeeded) {
    res.status(500).json({
      message: result.errors
        ? Object.values(result.errors)[0] ?? failMessage
        : failMessage,
      ...result,
    });
    return;
  }
  res.json(result);
}

export function listLegacyDumpTargets(_req: AuthRequest, res: Response): void {
  res.json({ targets: describeLegacyDumpTargets() });
}

export async function auditLegacyDump(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const classified = classifyUploads(req.files as Express.Multer.File[] | undefined);
  if ("error" in classified) {
    jsonOrStreamError(req, res, 400, classified.error);
    return;
  }

  const selected = (
    ["production", "development"] as LegacyDumpTarget[]
  ).filter((name) => Boolean(resolveLegacyDumpUri(name)));
  if (selected.length === 0) {
    jsonOrStreamError(req, res, 500, "No MongoDB URIs are configured for audit.");
    return;
  }

  const stream = wantsSse(req);
  if (stream) {
    disableTimeouts(req, res);
    initSse(res);
    sseLog(
      res,
      `Audit started by ${actorLabel(req)} (${classified.files.map((f) => f.kind).join(", ")}).`,
    );
  }

  const onLog: LogFn = (message, level = "info") => {
    if (stream) sseLog(res, message, level);
  };

  const { result, succeeded } = await runDumpJobs({
    classified,
    mode: "audit",
    selected,
    actor: actorLabel(req),
    onLog,
  });

  console.log("[legacy-dump] audit", {
    actor: actorLabel(req),
    files: classified.files.map((f) => f.kind),
    production: result.targets.production.label,
    development: result.targets.development.label,
    errors: Object.keys(result.errors ?? {}),
  });

  finishDumpResponse(req, res, stream, result, succeeded, "Audit failed.");
}

export async function executeLegacyDump(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  await runExecute(req, res, {
    runProduction: parseBool(body.production),
    runDevelopment: parseBool(body.development),
    confirmProduction: parseBool(body.confirmProduction),
  });
}

async function runExecute(
  req: AuthRequest,
  res: Response,
  options: {
    runProduction: boolean;
    runDevelopment: boolean;
    confirmProduction: boolean;
  },
): Promise<void> {
  if (executeInFlight) {
    jsonOrStreamError(req, res, 409, "A legacy dump import is already running.");
    return;
  }

  const classified = classifyUploads(req.files as Express.Multer.File[] | undefined);
  if ("error" in classified) {
    jsonOrStreamError(req, res, 400, classified.error);
    return;
  }

  const { runProduction, runDevelopment, confirmProduction } = options;
  if (!runProduction && !runDevelopment) {
    jsonOrStreamError(req, res, 400, "Select production and/or development.");
    return;
  }
  if (runProduction && !confirmProduction) {
    jsonOrStreamError(
      req,
      res,
      400,
      "Confirm production import before executing against production.",
    );
    return;
  }

  const targets = describeLegacyDumpTargets();
  const selected: LegacyDumpTarget[] = [];
  if (runProduction) {
    if (!targets.production.available) {
      jsonOrStreamError(
        req,
        res,
        400,
        targets.production.reason ?? "Production URI is not configured.",
      );
      return;
    }
    selected.push("production");
  }
  if (runDevelopment) {
    if (!targets.development.available) {
      jsonOrStreamError(
        req,
        res,
        400,
        targets.development.reason ?? "Development URI is not configured.",
      );
      return;
    }
    selected.push("development");
  }

  const stream = wantsSse(req) || res.headersSent;
  executeInFlight = true;
  try {
    if (stream && !res.headersSent) {
      disableTimeouts(req, res);
      initSse(res);
      sseLog(
        res,
        `Import started by ${actorLabel(req)} (${selected.join(", ")}).`,
      );
    } else if (stream) {
      sseLog(
        res,
        `Import started by ${actorLabel(req)} (${selected.join(", ")}).`,
      );
    }

    const onLog: LogFn = (message, level = "info") => {
      if (stream) sseLog(res, message, level);
    };

    const { result, succeeded } = await runDumpJobs({
      classified,
      mode: "import",
      selected,
      actor: actorLabel(req),
      onLog,
    });

    finishDumpResponse(req, res, stream, result, succeeded, "Import failed.");
  } finally {
    executeInFlight = false;
  }
}

export async function runLegacyDumpCommand(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawCommand = typeof body.command === "string" ? body.command : "";
  const parsed = parseLegacyDumpCommand(rawCommand);

  disableTimeouts(req, res);
  initSse(res);

  const onLog: LogFn = (message, level = "info") => {
    sseLog(res, message, level);
  };

  if (parsed.kind === "rejected") {
    onLog(parsed.message, "error");
    sendSse(res, "error", { message: parsed.message });
    endSse(res);
    return;
  }

  if (parsed.kind === "help") {
    onLog("Available commands:");
    for (const line of LEGACY_DUMP_HELP_LINES) {
      onLog(line);
    }
    endSse(res);
    return;
  }

  if (parsed.kind === "targets") {
    const targets = describeLegacyDumpTargets();
    for (const name of ["production", "development"] as LegacyDumpTarget[]) {
      const info = targets[name];
      if (info.available) {
        onLog(`${name}: ${info.label}`, "ok");
      } else {
        onLog(`${name}: unavailable (${info.reason ?? "not configured"})`, "warn");
      }
    }
    sendSse(res, "result", { targets });
    endSse(res);
    return;
  }

  if (parsed.kind === "counts") {
    const counts: Array<{
      target: LegacyDumpTarget;
      label: string;
      customers: number;
      workOrders: number;
    }> = [];
    for (const name of parsed.targets) {
      if (!resolveLegacyDumpUri(name)) {
        onLog(
          `${name}: ${
            name === "production"
              ? "MONGODB_URI_PRODUCTION is not set"
              : "MONGODB_URI_DEVELOPMENT is not set"
          }`,
          "warn",
        );
        continue;
      }
      try {
        counts.push(await countLegacyDumpCollections(name, (message) => onLog(message)));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Count failed.";
        onLog(`${name}: ${message}`, "error");
      }
    }
    sendSse(res, "result", { counts });
    endSse(res);
    return;
  }

  if (parsed.kind === "audit") {
    const classified = classifyUploads(
      req.files as Express.Multer.File[] | undefined,
    );
    if ("error" in classified) {
      onLog(classified.error, "error");
      sendSse(res, "error", { message: classified.error });
      endSse(res);
      return;
    }
    const selected = (
      ["production", "development"] as LegacyDumpTarget[]
    ).filter((name) => Boolean(resolveLegacyDumpUri(name)));
    if (selected.length === 0) {
      onLog("No MongoDB URIs are configured for audit.", "error");
      sendSse(res, "error", {
        message: "No MongoDB URIs are configured for audit.",
      });
      endSse(res);
      return;
    }
    onLog(
      `Audit started by ${actorLabel(req)} (${classified.files.map((f) => f.kind).join(", ")}).`,
    );
    const { result, succeeded } = await runDumpJobs({
      classified,
      mode: "audit",
      selected,
      actor: actorLabel(req),
      onLog,
    });
    finishDumpResponse(req, res, true, result, succeeded, "Audit failed.");
    return;
  }

  const classified = classifyUploads(
    req.files as Express.Multer.File[] | undefined,
  );
  if ("error" in classified) {
    onLog(classified.error, "error");
    sendSse(res, "error", { message: classified.error });
    endSse(res);
    return;
  }

  await runExecute(req, res, {
    runProduction: parsed.production,
    runDevelopment: parsed.development,
    confirmProduction: parsed.confirmProduction,
  });
}
