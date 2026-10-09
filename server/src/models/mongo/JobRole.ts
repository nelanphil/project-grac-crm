import mongoose, { Schema, Document } from "mongoose";

export const JOB_ROLE_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "phone",
  "email",
] as const;

export type JobRoleFieldType = (typeof JOB_ROLE_FIELD_TYPES)[number];

export const JOB_ROLE_DASHBOARD_VIEWS = ["default", "todo"] as const;

export type JobRoleDashboardView = (typeof JOB_ROLE_DASHBOARD_VIEWS)[number];

export interface IJobRoleField {
  key: string;
  label: string;
  type: JobRoleFieldType;
  required: boolean;
  options: string[];
  helpText: string;
  order: number;
}

export interface IJobRoleCapabilities {
  /** Can be placed on the schedule board and assigned to work orders. */
  schedulable: boolean;
  /** Customers in this person's territory are assigned to them. */
  territoryOwner: boolean;
}

export interface IJobRole extends Document {
  slug: string;
  label: string;
  description: string;
  color: string;
  isSystem: boolean;
  capabilities: IJobRoleCapabilities;
  /** Kept on the role. The staff home no longer follows this value. */
  dashboardView: JobRoleDashboardView;
  fields: IJobRoleField[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const fieldSchema = new Schema<IJobRoleField>(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: JOB_ROLE_FIELD_TYPES, required: true },
    required: { type: Boolean, default: false },
    options: { type: [String], default: [] },
    helpText: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const capabilitiesSchema = new Schema<IJobRoleCapabilities>(
  {
    schedulable: { type: Boolean, default: false },
    territoryOwner: { type: Boolean, default: false },
  },
  { _id: false },
);

const jobRoleSchema = new Schema<IJobRole>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    label: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    color: { type: String, default: "#44403c" },
    isSystem: { type: Boolean, default: false },
    capabilities: {
      type: capabilitiesSchema,
      default: () => ({ schedulable: false, territoryOwner: false }),
    },
    dashboardView: {
      type: String,
      enum: JOB_ROLE_DASHBOARD_VIEWS,
      default: "default",
    },
    fields: { type: [fieldSchema], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const JobRole = mongoose.model<IJobRole>("JobRole", jobRoleSchema);

const SYSTEM_JOB_ROLES: {
  slug: string;
  label: string;
  description: string;
  color: string;
  capabilities: IJobRoleCapabilities;
  dashboardView: JobRoleDashboardView;
}[] = [
  {
    slug: "technician",
    label: "Technician",
    description: "Can be scheduled for work order appointments.",
    color: "#c2410c",
    capabilities: { schedulable: true, territoryOwner: false },
    dashboardView: "todo",
  },
  {
    slug: "territory-owner",
    label: "Territory owner",
    description:
      "Customers in this person's counties and ZIP carve-outs are assigned to them.",
    color: "#1e3a5f",
    capabilities: { schedulable: false, territoryOwner: true },
    dashboardView: "default",
  },
];

/** Insert system job roles. Labels and custom fields are left alone after the first insert. */
export async function seedDefaultJobRoles(): Promise<void> {
  for (const role of SYSTEM_JOB_ROLES) {
    await JobRole.updateOne(
      { slug: role.slug },
      {
        $setOnInsert: {
          slug: role.slug,
          label: role.label,
          description: role.description,
          color: role.color,
          isSystem: true,
          capabilities: role.capabilities,
          dashboardView: role.dashboardView,
          fields: [],
          deletedAt: null,
        },
      },
      { upsert: true },
    );
    const locked: Record<string, boolean> = { isSystem: true };
    if (role.capabilities.schedulable) locked["capabilities.schedulable"] = true;
    if (role.capabilities.territoryOwner) {
      locked["capabilities.territoryOwner"] = true;
    }
    await JobRole.updateOne({ slug: role.slug }, { $set: locked });
  }
  // Fill the view only when it has never been chosen, so later edits stick.
  await JobRole.updateOne(
    { slug: "technician", dashboardView: { $exists: false } },
    { $set: { dashboardView: "todo" } },
  );
  await JobRole.updateMany(
    { dashboardView: { $exists: false } },
    { $set: { dashboardView: "default" } },
  );
  console.log("Job roles collection seeded");
}
