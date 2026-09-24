import mongoose, { Schema, Document, Types } from "mongoose";
import {
  defaultWeeklyHours,
  type HomeLocation,
  type ScheduleException,
  type WeeklyHours,
} from "../../utils/scheduleTime";
import { rolesAreSchedulable } from "../../utils/jobRoles";
import { CUSTOMER_ROLE, syncRoleFields, type UserType } from "../../utils/roles";

// UserRole is now an open string to support dynamic roles
export type UserRole = string;

export type IUserHomeLocation = HomeLocation;
export type IWeeklyHours = WeeklyHours;
export type IScheduleException = ScheduleException;

export interface IUserTerritories {
  /** FL county names (no "County" suffix), e.g. "Orange". */
  counties: string[];
  /** Exclusive 5-digit ZIP carve-outs. */
  zips: string[];
}

export interface IUser extends Document {
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  /** Highest-ranked assigned security role. Always derived from `roles`. */
  role: UserRole;
  /** Security role slugs. Source of truth for application permissions. */
  roles: UserRole[];
  /** Staff can use job roles and the CRM. Customers are portal logins. */
  userType: UserType;
  /** Job roles describing what a staff member does. Staff only. */
  jobRoles: Types.ObjectId[];
  /** Values for each job role's form-builder fields, keyed by job role id. */
  jobRoleData: Record<string, Record<string, unknown>>;
  /** Display / login handle (not unique). Never includes numeric suffix. */
  username: string | null;
  /** Unique backend key, e.g. doc1 / doc2. Never exposed to clients. */
  usernameKey: string | null;
  /** Geographic territories for staff with a territory-owner job role. */
  territories: IUserTerritories;
  /**
   * Denormalized from job-role capabilities so schedule queries stay indexed.
   * True when any assigned job role is schedulable.
   */
  schedulable: boolean;
  homeLocation: IUserHomeLocation;
  weeklyHours: IWeeklyHours;
  scheduleExceptions: IScheduleException[];
  /** When the user accepted the Terms of Service. */
  termsAcceptedAt: Date | null;
  /** When the user accepted the Privacy Policy. */
  privacyAcceptedAt: Date | null;
  /** Optional opt-in for automated text message alerts. */
  smsOptIn: boolean;
  /** When smsOptIn was last set to true. */
  smsOptInAt: Date | null;
  /** Mobile number collected at signup or legal consent. */
  phone: string;
  /** Version string of the legal docs accepted (e.g. "2026-08-03"). */
  legalDocsVersion: string | null;
  /** Per-user dashboard nav customization. */
  uiPreferences: IUserUiPreferences;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserNavOrder {
  /** Flat order of top-level item hrefs across every section. */
  order: string[];
  /** parentHref -> ordered child item hrefs within that parent. */
  children: Record<string, string[]>;
  /** Hrefs the user removed from the nav. */
  hidden: string[];
}

export interface IUserUiPreferences {
  navOrder: IUserNavOrder;
}

const territoriesSchema = new Schema<IUserTerritories>(
  {
    counties: { type: [String], default: [] },
    zips: { type: [String], default: [] },
  },
  { _id: false },
);

const weeklyDaySchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: "08:00" },
    end: { type: String, default: "17:00" },
  },
  { _id: false },
);

const weeklyHoursSchema = new Schema<IWeeklyHours>(
  {
    sun: { type: weeklyDaySchema, default: () => ({ enabled: false, start: "08:00", end: "17:00" }) },
    mon: { type: weeklyDaySchema, default: () => ({ enabled: true, start: "08:00", end: "17:00" }) },
    tue: { type: weeklyDaySchema, default: () => ({ enabled: true, start: "08:00", end: "17:00" }) },
    wed: { type: weeklyDaySchema, default: () => ({ enabled: true, start: "08:00", end: "17:00" }) },
    thu: { type: weeklyDaySchema, default: () => ({ enabled: true, start: "08:00", end: "17:00" }) },
    fri: { type: weeklyDaySchema, default: () => ({ enabled: true, start: "08:00", end: "17:00" }) },
    sat: { type: weeklyDaySchema, default: () => ({ enabled: false, start: "08:00", end: "17:00" }) },
  },
  { _id: false },
);

const homeLocationSchema = new Schema<IUserHomeLocation>(
  {
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    zip: { type: String, default: "" },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: false },
);

const scheduleExceptionSchema = new Schema<IScheduleException>(
  {
    date: { type: String, required: true },
    type: { type: String, enum: ["off", "custom"], required: true },
    start: { type: String, default: undefined },
    end: { type: String, default: undefined },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const navOrderSchema = new Schema<IUserNavOrder>(
  {
    order: { type: [String], default: [] },
    children: { type: Schema.Types.Mixed, default: () => ({}) },
    hidden: { type: [String], default: [] },
  },
  { _id: false },
);

const uiPreferencesSchema = new Schema<IUserUiPreferences>(
  {
    navOrder: {
      type: navOrderSchema,
      default: () => ({ order: [], children: {}, hidden: [] }),
    },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password_hash: { type: String, required: true },
    first_name: { type: String, required: true, trim: true },
    last_name: { type: String, required: true, trim: true },
    role: { type: String, default: "agent", required: true },
    roles: { type: [String], default: [] },
    userType: {
      type: String,
      enum: ["staff", "customer"],
      index: true,
    },
    jobRoles: { type: [{ type: Schema.Types.ObjectId, ref: "JobRole" }], default: [] },
    jobRoleData: { type: Schema.Types.Mixed, default: () => ({}) },
    username: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
      index: true,
    },
    usernameKey: { type: String, default: null, lowercase: true, trim: true },
    territories: {
      type: territoriesSchema,
      default: () => ({ counties: [], zips: [] }),
    },
    schedulable: { type: Boolean, default: false, index: true },
    homeLocation: {
      type: homeLocationSchema,
      default: () => ({
        address: "",
        city: "",
        state: "",
        zip: "",
        lat: null,
        lng: null,
      }),
    },
    weeklyHours: {
      type: weeklyHoursSchema,
      default: () => defaultWeeklyHours(false),
    },
    scheduleExceptions: { type: [scheduleExceptionSchema], default: [] },
    termsAcceptedAt: { type: Date, default: null },
    privacyAcceptedAt: { type: Date, default: null },
    smsOptIn: { type: Boolean, default: false },
    smsOptInAt: { type: Date, default: null },
    phone: { type: String, default: "" },
    legalDocsVersion: { type: String, default: null },
    uiPreferences: {
      type: uiPreferencesSchema,
      default: () => ({ navOrder: { order: [], children: {}, hidden: [] } }),
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ roles: 1 });
userSchema.index({ jobRoles: 1 });

userSchema.index(
  { usernameKey: 1 },
  {
    unique: true,
    partialFilterExpression: { usernameKey: { $type: "string" } },
  },
);

userSchema.pre("save", async function syncRoles() {
  const incomingRoles = Array.isArray(this.roles) ? this.roles : [];
  const looksLikeCustomer =
    this.userType === "customer" ||
    (!this.userType &&
      (incomingRoles.includes(CUSTOMER_ROLE) || this.role === CUSTOMER_ROLE));

  if (looksLikeCustomer) {
    this.userType = "customer";
    this.roles = [CUSTOMER_ROLE];
    this.role = CUSTOMER_ROLE;
    this.jobRoles = [];
    this.jobRoleData = {};
    this.markModified("jobRoleData");
    this.territories = { counties: [], zips: [] };
    this.schedulable = false;
    return;
  }

  this.userType = "staff";
  const synced = syncRoleFields({
    role: this.role,
    roles: incomingRoles.filter((slug) => slug !== CUSTOMER_ROLE),
  });
  this.roles = synced.roles;
  this.role = synced.role;
  this.schedulable = await rolesAreSchedulable(this.jobRoles ?? []);
});

export const User = mongoose.model<IUser>("User", userSchema);

/** Active (non–soft-deleted) users only. */
export const activeUserFilter = { deletedAt: null } as const;
