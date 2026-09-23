import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { JobRole, IJobRoleField } from "../models/mongo/JobRole";
import { User, activeUserFilter } from "../models/mongo/User";
import {
  createJobRoleSchema,
  updateJobRoleSchema,
  JobRoleFieldInput,
} from "../schemas/jobRole.schema";
import { clearJobRoleCapabilityCache } from "../utils/jobRoles";
import { isStaffUser } from "../utils/roles";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeFields(fields: JobRoleFieldInput[]): IJobRoleField[] {
  const keys = new Set<string>();
  return fields.map((field, index) => {
    if (keys.has(field.key)) {
      throw new Error(`Duplicate field key "${field.key}"`);
    }
    keys.add(field.key);
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required ?? false,
      options:
        field.type === "select" || field.type === "multiselect"
          ? field.options
          : [],
      helpText: field.helpText ?? "",
      order: field.order ?? index,
    };
  });
}

function formatJobRole(role: {
  _id: unknown;
  slug: string;
  label: string;
  description?: string;
  color?: string;
  isSystem?: boolean;
  capabilities?: { schedulable?: boolean; territoryOwner?: boolean } | null;
  fields?: IJobRoleField[] | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const fields = [...(role.fields ?? [])].sort((a, b) => a.order - b.order);
  return {
    _id: String(role._id),
    slug: role.slug,
    label: role.label,
    description: role.description ?? "",
    color: role.color ?? "#44403c",
    isSystem: Boolean(role.isSystem),
    capabilities: {
      schedulable: Boolean(role.capabilities?.schedulable),
      territoryOwner: Boolean(role.capabilities?.territoryOwner),
    },
    fields,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export async function listJobRoles(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (!req.user || !isStaffUser(req.user)) {
    res.status(403).json({ message: "Insufficient role" });
    return;
  }
  const roles = await JobRole.find({ deletedAt: null }).sort({ label: 1 }).lean();
  res.json({ jobRoles: roles.map(formatJobRole) });
}

export async function createJobRole(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = createJobRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { label, description, color, capabilities } = parsed.data;
  const slug = slugify(label);
  if (!slug) {
    res.status(400).json({ message: "Label must contain letters or numbers" });
    return;
  }

  let fields: IJobRoleField[];
  try {
    fields = normalizeFields(parsed.data.fields ?? []);
  } catch (err) {
    res.status(400).json({
      message: err instanceof Error ? err.message : "Invalid fields",
    });
    return;
  }

  const existing = await JobRole.findOne({ slug });
  if (existing && !existing.deletedAt) {
    res.status(409).json({ message: "A job role with that name already exists" });
    return;
  }

  const next = {
    label,
    description,
    color: color ?? "#44403c",
    isSystem: false,
    capabilities: capabilities ?? { schedulable: false, territoryOwner: false },
    fields,
    deletedAt: null,
  };

  const role = existing
    ? await JobRole.findByIdAndUpdate(existing._id, { $set: next }, { new: true })
    : await JobRole.create({ slug, ...next });

  clearJobRoleCapabilityCache();
  res.status(201).json({ jobRole: formatJobRole(role!) });
}

export async function updateJobRole(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = updateJobRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const role = await JobRole.findOne({ _id: req.params.id, deletedAt: null });
  if (!role) {
    res.status(404).json({ message: "Job role not found" });
    return;
  }

  if (parsed.data.label !== undefined) {
    const slug = slugify(parsed.data.label);
    const conflict = await JobRole.findOne({
      slug,
      _id: { $ne: role._id },
      deletedAt: null,
    })
      .select("_id")
      .lean();
    if (conflict) {
      res.status(409).json({ message: "A job role with that name already exists" });
      return;
    }
    role.label = parsed.data.label;
  }
  if (parsed.data.description !== undefined) {
    role.description = parsed.data.description;
  }
  if (parsed.data.color !== undefined) role.color = parsed.data.color;

  if (parsed.data.capabilities) {
    const next = parsed.data.capabilities;
    if (role.isSystem && role.slug === "technician" && !next.schedulable) {
      res.status(400).json({
        message: "The Technician job role must stay schedulable",
      });
      return;
    }
    if (role.isSystem && role.slug === "territory-owner" && !next.territoryOwner) {
      res.status(400).json({
        message: "The Territory owner job role must keep territory ownership",
      });
      return;
    }
    role.capabilities = next;
  }

  if (parsed.data.fields) {
    try {
      role.fields = normalizeFields(parsed.data.fields);
    } catch (err) {
      res.status(400).json({
        message: err instanceof Error ? err.message : "Invalid fields",
      });
      return;
    }
    role.markModified("fields");
  }

  await role.save();
  clearJobRoleCapabilityCache();

  if (parsed.data.capabilities) {
    const holders = await User.find({
      jobRoles: role._id,
      ...activeUserFilter,
    }).select("_id");
    for (const holder of holders) {
      const fresh = await User.findById(holder._id);
      if (fresh) await fresh.save();
    }
  }

  res.json({ jobRole: formatJobRole(role) });
}

export async function deleteJobRole(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const role = await JobRole.findOne({ _id: req.params.id, deletedAt: null });
  if (!role) {
    res.status(404).json({ message: "Job role not found" });
    return;
  }
  if (role.isSystem) {
    res.status(400).json({ message: "System job roles cannot be deleted" });
    return;
  }

  const holders = await User.find({ jobRoles: role._id, ...activeUserFilter }).select(
    "_id",
  );
  const force = req.query.force === "1" || req.query.force === "true";
  if (holders.length > 0 && !force) {
    res.status(409).json({
      message: `${holders.length} user(s) still have this job role`,
      userCount: holders.length,
    });
    return;
  }

  const roleId = String(role._id);
  for (const holder of holders) {
    const user = await User.findById(holder._id);
    if (!user) continue;
    user.jobRoles = user.jobRoles.filter((id) => String(id) !== roleId);
    if (user.jobRoleData && typeof user.jobRoleData === "object") {
      delete user.jobRoleData[roleId];
      user.markModified("jobRoleData");
    }
    await user.save();
  }

  role.deletedAt = new Date();
  await role.save();
  clearJobRoleCapabilityCache();
  res.json({ message: "Job role deleted" });
}
