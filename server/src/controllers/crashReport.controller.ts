import { gzipSync } from "node:zlib";
import { Response } from "express";
import mongoose from "mongoose";
import { getMongoStatus } from "../config/mongodb";
import { AuthRequest } from "../middleware/auth.middleware";
import { CrashReport, ICrashReport } from "../models/mongo/CrashReport";
import { SourceMap } from "../models/mongo/SourceMap";
import {
  createCrashReportSchema,
  updateCrashReportSchema,
  uploadSourceMapsSchema,
} from "../schemas/crashReport.schema";
import { decodeStack, forgetSourceMap } from "../services/stackSymbolicator.service";

const PAGE_SIZES = [25, 50];
const MAX_RELATED = 10;
// Stay under MongoDB's 16MB document limit.
const MAX_STORED_MAP_BYTES = 15 * 1024 * 1024;

function parseOccurredAt(value: string | undefined): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function personName(value: unknown): string {
  if (!value || typeof value !== "object" || !("email" in value)) return "";
  const user = value as {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.email || "";
}

function mapSummary(report: ICrashReport) {
  return {
    id: report._id.toString(),
    status: report.status,
    origin: report.origin ?? "client",
    source: report.source,
    name: report.name,
    message: report.message,
    pathname: report.pathname,
    userEmail: report.userEmail,
    userRole: report.userRole,
    reporterEmail: report.reporterEmail,
    occurredAt: report.occurredAt.toISOString(),
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
    occurrences: report.occurrences ?? 1,
    lastSeenAt: report.lastSeenAt ? report.lastSeenAt.toISOString() : null,
    httpStatus: report.http?.status ?? null,
  };
}

function mapDetail(report: ICrashReport) {
  return {
    ...mapSummary(report),
    clientReportId: report.clientReportId ?? null,
    release: report.release ?? "",
    stack: report.stack,
    componentStack: report.componentStack,
    causes: (report.causes ?? []).map((item) => ({
      name: item.name,
      message: item.message,
      stack: item.stack,
    })),
    context: report.context ?? {},
    additionalErrors: (report.additionalErrors ?? []).map((item) => ({
      source: item.source,
      name: item.name,
      message: item.message,
      stack: item.stack,
      at: item.at,
    })),
    url: report.url,
    userAgent: report.userAgent,
    viewport: report.viewport,
    online: report.online,
    environment: report.environment ?? {},
    whatWereYouDoing: report.whatWereYouDoing,
    whatHappened: report.whatHappened,
    breadcrumbs: report.breadcrumbs.map((item) => ({
      t: item.t,
      type: item.type,
      detail: item.detail,
      ...(item.meta ? { meta: { ...item.meta } } : {}),
    })),
    requestId: report.requestId ?? "",
    requestIds: report.requestIds ?? [],
    http: report.http
      ? {
          method: report.http.method,
          route: report.http.route,
          path: report.http.path,
          status: report.http.status,
          bodyKeys: report.http.bodyKeys ?? [],
        }
      : null,
    fingerprint: report.fingerprint ?? "",
    resolutionNote: report.resolutionNote,
    resolvedByName: personName(report.resolvedBy),
    ip: report.ip,
  };
}

function breadcrumbRequestIds(report: ICrashReport): string[] {
  const ids = new Set<string>();
  for (const item of report.breadcrumbs) {
    if (item.meta?.requestId) ids.add(item.meta.requestId);
  }
  const contextId = report.context?.requestId;
  if (typeof contextId === "string" && contextId) ids.add(contextId);
  return [...ids].slice(0, 100);
}

async function buildDetail(report: ICrashReport) {
  const detail = mapDetail(report);
  const decoded =
    report.origin === "server" || !report.stack
      ? null
      : await decodeStack(report.stack).catch(() => null);

  let relatedServerErrors: ReturnType<typeof mapDetail>[] = [];
  let relatedClientReports: ReturnType<typeof mapSummary>[] = [];
  if (report.origin === "server") {
    const ids = report.requestIds ?? [];
    if (ids.length > 0) {
      const clients = await CrashReport.find({
        origin: { $ne: "server" },
        "breadcrumbs.meta.requestId": { $in: ids },
      })
        .sort({ createdAt: -1 })
        .limit(MAX_RELATED);
      relatedClientReports = clients.map(mapSummary);
    }
  } else {
    const ids = breadcrumbRequestIds(report);
    if (ids.length > 0) {
      const servers = await CrashReport.find({
        origin: "server",
        requestIds: { $in: ids },
      })
        .sort({ createdAt: -1 })
        .limit(MAX_RELATED);
      relatedServerErrors = servers.map(mapDetail);
    }
  }

  return {
    ...detail,
    decodedStack: decoded?.text ?? "",
    decodedFrames: decoded?.frames ?? [],
    sourceMapsFound: decoded?.mapped ?? 0,
    relatedServerErrors,
    relatedClientReports,
  };
}

export async function createCrashReport(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (getMongoStatus() !== "connected") {
    res
      .status(503)
      .json({ message: "Database unavailable. Please try again later." });
    return;
  }

  const parsed = createCrashReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const authed = req.user;

  try {
    if (data.clientReportId) {
      const existing = await CrashReport.findOne({
        clientReportId: data.clientReportId,
      });
      if (existing) {
        const narrative: Record<string, string> = {};
        if (data.whatWereYouDoing && !existing.whatWereYouDoing) {
          narrative.whatWereYouDoing = data.whatWereYouDoing;
        }
        if (data.whatHappened && !existing.whatHappened) {
          narrative.whatHappened = data.whatHappened;
        }
        if (!authed && data.reporterEmail && !existing.reporterEmail) {
          narrative.reporterEmail = data.reporterEmail;
        }
        if (Object.keys(narrative).length > 0) {
          await CrashReport.updateOne({ _id: existing._id }, { $set: narrative });
        }
        res.status(200).json({
          id: existing._id.toString(),
          message: "Crash report submitted",
        });
        return;
      }
    }

    const report = await CrashReport.create({
      status: "open",
      origin: "client",
      source: data.source,
      clientReportId: data.clientReportId ?? null,
      release: data.release ?? "",
      name: data.name || "Error",
      message: data.message,
      stack: data.stack ?? "",
      componentStack: data.componentStack ?? "",
      causes: data.causes ?? [],
      context: data.context ?? {},
      additionalErrors: data.additionalErrors ?? [],
      url: data.url ?? "",
      pathname: data.pathname ?? "",
      userAgent: data.userAgent ?? "",
      viewport: data.viewport ?? "",
      online: data.online ?? true,
      occurredAt: parseOccurredAt(data.occurredAt),
      environment: data.environment ?? {},
      whatWereYouDoing: data.whatWereYouDoing ?? "",
      whatHappened: data.whatHappened ?? "",
      reporterEmail: authed ? "" : (data.reporterEmail ?? ""),
      breadcrumbs: data.breadcrumbs ?? [],
      requestId: typeof data.context?.requestId === "string" ? data.context.requestId : "",
      userId: authed ? authed.id : null,
      userEmail: authed?.email ?? "",
      userRole: authed?.role ?? "",
      ip: req.ip || req.socket.remoteAddress || "",
    });

    res.status(201).json({
      id: report._id.toString(),
      message: "Crash report submitted",
    });
  } catch (error) {
    if ((error as { code?: number })?.code === 11000 && data.clientReportId) {
      const existing = await CrashReport.findOne({
        clientReportId: data.clientReportId,
      }).catch(() => null);
      if (existing) {
        res.status(200).json({
          id: existing._id.toString(),
          message: "Crash report submitted",
        });
        return;
      }
    }
    res.status(500).json({ message: "Failed to save crash report." });
  }
}

export async function listCrashReports(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const pageRaw = parseInt(String(req.query.page ?? "1"), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10);
    const pageSize = PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : 25;

    const statusRaw = String(req.query.status ?? "");
    const status =
      statusRaw === "open" || statusRaw === "resolved" ? statusRaw : null;
    const originRaw = String(req.query.origin ?? "");
    const originFilter =
      originRaw === "server"
        ? { origin: "server" }
        : originRaw === "client"
          ? { origin: { $ne: "server" } }
          : {};

    const filter = { ...originFilter, ...(status ? { status } : {}) };
    const [total, reports, openCount, resolvedCount] = await Promise.all([
      CrashReport.countDocuments(filter),
      CrashReport.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      CrashReport.countDocuments({ ...originFilter, status: "open" }),
      CrashReport.countDocuments({ ...originFilter, status: "resolved" }),
    ]);

    res.json({
      reports: reports.map(mapSummary),
      total,
      page,
      pageSize,
      openCount,
      resolvedCount,
    });
  } catch {
    res.status(500).json({ message: "Failed to load crash reports." });
  }
}

export async function getCrashReport(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const id = String(req.params.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ message: "Crash report not found" });
    return;
  }

  try {
    const report = await CrashReport.findById(id).populate(
      "resolvedBy",
      "first_name last_name email",
    );
    if (!report) {
      res.status(404).json({ message: "Crash report not found" });
      return;
    }
    res.json({ report: await buildDetail(report) });
  } catch {
    res.status(500).json({ message: "Failed to load crash report." });
  }
}

export async function updateCrashReport(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const id = String(req.params.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ message: "Crash report not found" });
    return;
  }

  const parsed = updateCrashReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const update: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.resolutionNote !== undefined) {
    update.resolutionNote = parsed.data.resolutionNote;
  }
  if (parsed.data.status === "resolved") {
    update.resolvedAt = new Date();
    update.resolvedBy = req.user?.id ?? null;
  } else {
    update.resolvedAt = null;
    update.resolvedBy = null;
  }

  try {
    const report = await CrashReport.findByIdAndUpdate(id, update, {
      new: true,
    }).populate("resolvedBy", "first_name last_name email");
    if (!report) {
      res.status(404).json({ message: "Crash report not found" });
      return;
    }
    res.json({ report: await buildDetail(report) });
  } catch {
    res.status(500).json({ message: "Failed to update crash report." });
  }
}

export async function uploadSourceMaps(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = uploadSourceMapsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const now = new Date();
    const maps = parsed.data.maps.map((item) => ({
      file: item.file.replace(/^\/+/, "").replace(/\.map$/, ""),
      content: gzipSync(item.content),
    }));
    if (maps.some((item) => item.content.length > MAX_STORED_MAP_BYTES)) {
      res.status(413).json({ message: "A source map is too large to store." });
      return;
    }
    await SourceMap.bulkWrite(
      maps.map((item) => ({
        updateOne: {
          filter: { file: item.file },
          update: { $set: { content: item.content, createdAt: now } },
          upsert: true,
        },
      })),
    );
    for (const item of maps) forgetSourceMap(item.file);
    res.json({ stored: maps.length });
  } catch {
    res.status(500).json({ message: "Failed to store source maps." });
  }
}
