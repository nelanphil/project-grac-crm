import mongoose, { Schema, Document, Types } from "mongoose";

export type CrashReportStatus = "open" | "resolved";
export type CrashReportSource =
  | "render"
  | "window"
  | "unhandledrejection"
  | "chunk";

export interface ICrashBreadcrumb {
  t: number;
  type: "route" | "click" | "api";
  detail: string;
}

export interface ICrashReport extends Document {
  status: CrashReportStatus;
  source: CrashReportSource;
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  url: string;
  pathname: string;
  userAgent: string;
  viewport: string;
  online: boolean;
  occurredAt: Date;
  whatWereYouDoing: string;
  whatHappened: string;
  reporterEmail: string;
  breadcrumbs: ICrashBreadcrumb[];
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
    type: { type: String, enum: ["route", "click", "api"], required: true },
    detail: { type: String, required: true },
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
    source: {
      type: String,
      enum: ["render", "window", "unhandledrejection", "chunk"],
      required: true,
    },
    name: { type: String, default: "Error" },
    message: { type: String, required: true },
    stack: { type: String, default: "" },
    componentStack: { type: String, default: "" },
    url: { type: String, default: "" },
    pathname: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    viewport: { type: String, default: "" },
    online: { type: Boolean, default: true },
    occurredAt: { type: Date, required: true },
    whatWereYouDoing: { type: String, required: true },
    whatHappened: { type: String, required: true },
    reporterEmail: { type: String, default: "" },
    breadcrumbs: { type: [breadcrumbSchema], default: [] },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    userEmail: { type: String, default: "" },
    userRole: { type: String, default: "" },
    ip: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolutionNote: { type: String, default: "" },
  },
  { timestamps: true },
);

crashReportSchema.index({ status: 1, createdAt: -1 });
crashReportSchema.index({ createdAt: -1 });

export const CrashReport = mongoose.model<ICrashReport>(
  "CrashReport",
  crashReportSchema,
);
