import mongoose, { Schema, Document, Types } from "mongoose";

export type CrashReportStatus = "open" | "resolved";
export type CrashReportOrigin = "client" | "server";
export type CrashReportSource =
  | "render"
  | "window"
  | "unhandledrejection"
  | "chunk"
  | "server";

export const BREADCRUMB_TYPES = [
  "route",
  "click",
  "api",
  "console",
  "error",
  "lifecycle",
] as const;
export type CrashBreadcrumbType = (typeof BREADCRUMB_TYPES)[number];

export interface ICrashBreadcrumbMeta {
  status?: number;
  durationMs?: number;
  requestId?: string;
  message?: string;
}

export interface ICrashBreadcrumb {
  t: number;
  type: CrashBreadcrumbType;
  detail: string;
  meta?: ICrashBreadcrumbMeta;
}

export interface ICrashErrorPart {
  name: string;
  message: string;
  stack: string;
}

export interface ICrashAdditionalError extends ICrashErrorPart {
  source: string;
  at: string;
}

export interface ICrashHttp {
  method: string;
  route: string;
  path: string;
  status: number;
  bodyKeys: string[];
}

export interface ICrashReport extends Document {
  status: CrashReportStatus;
  origin: CrashReportOrigin;
  source: CrashReportSource;
  clientReportId: string | null;
  release: string;
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  causes: ICrashErrorPart[];
  context: Record<string, string | number | boolean>;
  additionalErrors: ICrashAdditionalError[];
  url: string;
  pathname: string;
  userAgent: string;
  viewport: string;
  online: boolean;
  occurredAt: Date;
  environment: Record<string, string | number | boolean>;
  whatWereYouDoing: string;
  whatHappened: string;
  reporterEmail: string;
  breadcrumbs: ICrashBreadcrumb[];
  requestId: string;
  requestIds: string[];
  http: ICrashHttp | null;
  fingerprint: string;
  occurrences: number;
  lastSeenAt: Date | null;
  userId: Types.ObjectId | null;
  userEmail: string;
  userRole: string;
  ip: string;
  resolvedAt: Date | null;
  resolvedBy: Types.ObjectId | null;
  resolutionNote: string;
  createdAt: Date;
  updatedAt: Date;
}

const breadcrumbSchema = new Schema<ICrashBreadcrumb>(
  {
    t: { type: Number, required: true },
    type: { type: String, enum: BREADCRUMB_TYPES, required: true },
    detail: { type: String, required: true },
    meta: {
      type: new Schema<ICrashBreadcrumbMeta>(
        {
          status: Number,
          durationMs: Number,
          requestId: String,
          message: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { _id: false },
);

const errorPartSchema = new Schema<ICrashErrorPart>(
  {
    name: { type: String, default: "" },
    message: { type: String, default: "" },
    stack: { type: String, default: "" },
  },
  { _id: false },
);

const additionalErrorSchema = new Schema<ICrashAdditionalError>(
  {
    source: { type: String, default: "" },
    name: { type: String, default: "" },
    message: { type: String, default: "" },
    stack: { type: String, default: "" },
    at: { type: String, default: "" },
  },
  { _id: false },
);

const httpSchema = new Schema<ICrashHttp>(
  {
    method: { type: String, default: "" },
    route: { type: String, default: "" },
    path: { type: String, default: "" },
    status: { type: Number, default: 0 },
    bodyKeys: { type: [String], default: [] },
  },
  { _id: false },
);

const crashReportSchema = new Schema<ICrashReport>(
  {
    status: {
      type: String,
      enum: ["open", "resolved"],
      default: "open",
      index: true,
    },
    origin: {
      type: String,
      enum: ["client", "server"],
      default: "client",
    },
    source: {
      type: String,
      enum: ["render", "window", "unhandledrejection", "chunk", "server"],
      required: true,
    },
    clientReportId: { type: String, default: null },
    release: { type: String, default: "" },
    name: { type: String, default: "Error" },
    message: { type: String, required: true },
    stack: { type: String, default: "" },
    componentStack: { type: String, default: "" },
    causes: { type: [errorPartSchema], default: [] },
    context: { type: Schema.Types.Mixed, default: {} },
    additionalErrors: { type: [additionalErrorSchema], default: [] },
    url: { type: String, default: "" },
    pathname: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    viewport: { type: String, default: "" },
    online: { type: Boolean, default: true },
    occurredAt: { type: Date, required: true },
    environment: { type: Schema.Types.Mixed, default: {} },
    whatWereYouDoing: { type: String, default: "" },
    whatHappened: { type: String, default: "" },
    reporterEmail: { type: String, default: "" },
    breadcrumbs: { type: [breadcrumbSchema], default: [] },
    requestId: { type: String, default: "" },
    requestIds: { type: [String], default: [] },
    http: { type: httpSchema, default: null },
    fingerprint: { type: String, default: "" },
    occurrences: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    userEmail: { type: String, default: "" },
    userRole: { type: String, default: "" },
    ip: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolutionNote: { type: String, default: "" },
  },
  { timestamps: true, minimize: false },
);

crashReportSchema.index({ status: 1, createdAt: -1 });
crashReportSchema.index({ createdAt: -1 });
crashReportSchema.index({ origin: 1, status: 1, createdAt: -1 });
crashReportSchema.index({ requestIds: 1 });
crashReportSchema.index({ "breadcrumbs.meta.requestId": 1 }, { sparse: true });
crashReportSchema.index({ fingerprint: 1, lastSeenAt: -1 });
crashReportSchema.index(
  { clientReportId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientReportId: { $type: "string" } },
  },
);

export const CrashReport = mongoose.model<ICrashReport>(
  "CrashReport",
  crashReportSchema,
);
