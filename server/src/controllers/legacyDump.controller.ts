import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  describeLegacyDumpTargets,
  detectDumpKind,
  LegacyDumpTarget,
  runLegacyDumpSync,
  resolveLegacyDumpUri,
} from "../services/legacyDumpSync";

const MAX_FILES = 2;
let executeInFlight = false;

type ClassifiedDump = {
  customerSql?: string;
  workOrderSql?: string;
  files: Array<{ filename: string; kind: "customers" | "work_orders" }>;
};

function classifyUploads(files: Express.Multer.File[] | undefined): ClassifiedDump | { error: string } {
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

export function listLegacyDumpTargets(_req: AuthRequest, res: Response): void {
  res.json({ targets: describeLegacyDumpTargets() });
}

export async function auditLegacyDump(req: AuthRequest, res: Response): Promise<void> {
  const classified = classifyUploads(req.files as Express.Multer.File[] | undefined);
  if ("error" in classified) {
    res.status(400).json({ message: classified.error });
    return;
  }

  const targets = describeLegacyDumpTargets();
  const result: Record<string, unknown> = {
    files: classified.files,
    targets,
  };

  const jobs: Array<{ name: LegacyDumpTarget; promise: Promise<unknown> }> = [];
  for (const name of ["production", "development"] as LegacyDumpTarget[]) {
    const uri = resolveLegacyDumpUri(name);
    if (!uri) continue;
    jobs.push({
      name,
      promise: runLegacyDumpSync({
        customerSql: classified.customerSql,
        workOrderSql: classified.workOrderSql,
        mongoUri: uri,
        mode: "audit",
        target: name,
      }),
    });
  }

  if (jobs.length === 0) {
    res.status(500).json({ message: "No MongoDB URIs are configured for audit." });
    return;
  }

  const settled = await Promise.allSettled(jobs.map((job) => job.promise));
  const errors: Partial<Record<LegacyDumpTarget, string>> = {};
  settled.forEach((item, index) => {
    const job = jobs[index];
    if (!job) return;
    const name = job.name;
    if (item.status === "fulfilled") {
      result[name] = item.value;
      return;
    }
    const message =
      item.reason instanceof Error ? item.reason.message : "Audit failed.";
    errors[name] = message;
    console.error("[legacy-dump] audit failed", {
      actor: actorLabel(req),
      target: name,
      message,
    });
  });

  if (Object.keys(errors).length > 0) {
    result.errors = errors;
  }

  const succeeded = jobs.some((job) => result[job.name] != null);
  if (!succeeded) {
    res.status(500).json({
      message: Object.values(errors)[0] ?? "Audit failed.",
      files: classified.files,
      targets,
      errors,
    });
    return;
  }

  console.log("[legacy-dump] audit", {
    actor: actorLabel(req),
    files: classified.files.map((f) => f.kind),
    production: targets.production.label,
    development: targets.development.label,
    errors: Object.keys(errors),
  });

  res.json(result);
}

export async function executeLegacyDump(req: AuthRequest, res: Response): Promise<void> {
  if (executeInFlight) {
    res.status(409).json({ message: "A legacy dump import is already running." });
    return;
  }

  const classified = classifyUploads(req.files as Express.Multer.File[] | undefined);
  if ("error" in classified) {
    res.status(400).json({ message: classified.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const runProduction = parseBool(body.production);
  const runDevelopment = parseBool(body.development);
  const confirmProduction = parseBool(body.confirmProduction);

  if (!runProduction && !runDevelopment) {
    res.status(400).json({ message: "Select production and/or development." });
    return;
  }
  if (runProduction && !confirmProduction) {
    res.status(400).json({
      message: "Confirm production import before executing against production.",
    });
    return;
  }

  const targets = describeLegacyDumpTargets();
  const selected: LegacyDumpTarget[] = [];
  if (runProduction) {
    if (!targets.production.available) {
      res.status(400).json({ message: targets.production.reason ?? "Production URI is not configured." });
      return;
    }
    selected.push("production");
  }
  if (runDevelopment) {
    if (!targets.development.available) {
      res.status(400).json({
        message: targets.development.reason ?? "Development URI is not configured.",
      });
      return;
    }
    selected.push("development");
  }

  executeInFlight = true;
  const result: Record<string, unknown> = { files: classified.files, targets };
  const errors: Partial<Record<LegacyDumpTarget, string>> = {};

  try {
    for (const name of selected) {
      const uri = resolveLegacyDumpUri(name);
      if (!uri) {
        errors[name] =
          name === "production"
            ? "MONGODB_URI_PRODUCTION is not set"
            : "MONGODB_URI_DEVELOPMENT is not set";
        continue;
      }
      try {
        const report = await runLegacyDumpSync({
          customerSql: classified.customerSql,
          workOrderSql: classified.workOrderSql,
          mongoUri: uri,
          mode: "import",
          target: name,
        });
        result[name] = report;
        console.log("[legacy-dump] execute", {
          actor: actorLabel(req),
          target: name,
          host: report.targetLabel,
          customersInserted: report.summary.customersInserted,
          workOrdersInserted: report.summary.workOrdersInserted,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Import failed.";
        errors[name] = message;
        console.error("[legacy-dump] execute failed", {
          actor: actorLabel(req),
          target: name,
          message,
        });
      }
    }

    if (Object.keys(errors).length > 0) {
      result.errors = errors;
    }

    const succeeded = selected.some((name) => result[name] != null);
    if (!succeeded) {
      res.status(500).json({
        message: Object.values(errors)[0] ?? "Import failed.",
        files: classified.files,
        targets,
        errors,
      });
      return;
    }

    res.json(result);
  } finally {
    executeInFlight = false;
  }
}
