import { Response } from "express";
import mongoose from "mongoose";
import { getMongoStatus } from "../config/mongodb";
import { AuthRequest } from "../middleware/auth.middleware";
import { CrashReport, ICrashReport } from "../models/mongo/CrashReport";
import {
  createCrashReportSchema,
  updateCrashReportSchema,
} from "../schemas/crashReport.schema";

const PAGE_SIZES = [25, 50];

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
  };
}

function mapDetail(report: ICrashReport) {
  return {
    ...mapSummary(report),
    stack: report.stack,
    componentStack: report.componentStack,
    url: report.url,
    userAgent: report.userAgent,
    viewport: report.viewport,
    online: report.online,
    whatWereYouDoing: report.whatWereYouDoing,
    whatHappened: report.whatHappened,
    breadcrumbs: report.breadcrumbs.map((item) => ({
      t: item.t,
      type: item.type,
      detail: item.detail,
    })),
    resolutionNote: report.resolutionNote,
    resolvedByName: personName(report.resolvedBy),
    ip: report.ip,
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
    const report = await CrashReport.create({
      status: "open",
      source: data.source,
      name: data.name || "Error",
      message: data.message,
      stack: data.stack ?? "",
      componentStack: data.componentStack ?? "",
      url: data.url ?? "",
      pathname: data.pathname ?? "",
      userAgent: data.userAgent ?? "",
      viewport: data.viewport ?? "",
      online: data.online ?? true,
      occurredAt: parseOccurredAt(data.occurredAt),
      whatWereYouDoing: data.whatWereYouDoing,
      whatHappened: data.whatHappened,
      reporterEmail: authed ? "" : (data.reporterEmail ?? ""),
      breadcrumbs: data.breadcrumbs ?? [],
      userId: authed ? authed.id : null,
      userEmail: authed?.email ?? "",
      userRole: authed?.role ?? "",
      ip: req.ip || req.socket.remoteAddress || "",
    });

    res.status(201).json({
      id: report._id.toString(),
      message: "Crash report submitted",
    });
  } catch {
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

    const filter = status ? { status } : {};
    const [total, reports, openCount, resolvedCount] = await Promise.all([
      CrashReport.countDocuments(filter),
      CrashReport.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      CrashReport.countDocuments({ status: "open" }),
      CrashReport.countDocuments({ status: "resolved" }),
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
    res.json({ report: mapDetail(report) });
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
    res.json({ report: mapDetail(report) });
  } catch {
    res.status(500).json({ message: "Failed to update crash report." });
  }
}
