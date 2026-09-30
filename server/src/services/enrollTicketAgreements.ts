import { Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { Customer } from "../models/mongo/Customer";
import {
  computeInitialRenewalDueDate,
  DEFAULT_DURATION_MONTHS,
  parseDateOnly,
} from "../utils/contractDates";

export interface EnrollableAgreementLine {
  lineType?: string;
  description?: string;
  contractTemplateRef?: unknown;
  enrolledContractRef?: unknown;
}

export interface EnrollableWorkOrder {
  _id: unknown;
  customerId: number;
  customerRef?: unknown;
  addressRef?: unknown;
  equipmentRef?: unknown;
  date?: Date | string | null;
  userId?: number;
  parts?: EnrollableAgreementLine[];
  markModified?: (path: string) => void;
  save?: () => Promise<unknown>;
}

export interface AgreementContractRecord {
  _id: string;
  templateId: string | null;
  sourceWorkOrderRef: string | null;
  equipmentRef: string | null;
  temporary?: boolean;
}

export interface AgreementTemplateRecord {
  _id: string;
  label: string;
  slug: string;
  deletedAt?: Date | null;
}

export interface NewAgreementContract {
  customerId: number;
  customerRef: string;
  addressRef: string | null;
  equipmentRef: string | null;
  templateId: string;
  description: string;
  contractType: string;
  durationMonths: number;
  contractDate: Date | null;
  sourceWorkOrderRef: string;
  userId?: number;
}

export interface AgreementEnrollmentDeps {
  resolveCustomerRef: (workOrder: EnrollableWorkOrder) => Promise<string | null>;
  findTemplate: (id: string) => Promise<AgreementTemplateRecord | null>;
  findCustomerContracts: (customer: {
    customerId: number;
    customerRef: string;
  }) => Promise<AgreementContractRecord[]>;
  createContract: (input: NewAgreementContract) => Promise<{ _id: string }>;
}

export type AgreementEnrollmentDecision =
  | { action: "link"; contractId: string }
  | { action: "create" };

export function idString(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && "toHexString" in value) {
    const hex = (value as { toHexString?: () => string }).toHexString;
    if (typeof hex === "function") return hex.call(value);
  }
  const text = String(value).trim();
  return text || null;
}

export function decideAgreementEnrollment(input: {
  templateId: string;
  enrolledContractRef: string | null;
  workOrderId: string;
  equipmentRef: string | null;
  contracts: AgreementContractRecord[];
}): AgreementEnrollmentDecision {
  const live = input.contracts.filter((contract) => !contract.temporary);
  if (input.enrolledContractRef) {
    const current = live.find(
      (contract) => contract._id === input.enrolledContractRef,
    );
    if (current) return { action: "link", contractId: current._id };
  }
  const fromThisOrder = live.find(
    (contract) =>
      contract.templateId === input.templateId &&
      contract.sourceWorkOrderRef === input.workOrderId,
  );
  if (fromThisOrder) return { action: "link", contractId: fromThisOrder._id };
  const sameEquipment = live.find(
    (contract) =>
      contract.templateId === input.templateId &&
      contract.equipmentRef === input.equipmentRef,
  );
  if (sameEquipment) return { action: "link", contractId: sameEquipment._id };
  return { action: "create" };
}

function storedRef(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

const defaultDeps: AgreementEnrollmentDeps = {
  async resolveCustomerRef(workOrder) {
    const existing = idString(workOrder.customerRef);
    if (existing) return existing;
    if (!workOrder.customerId) return null;
    const customer = await Customer.findOne({ legacyId: workOrder.customerId })
      .select("_id")
      .lean();
    return customer ? String(customer._id) : null;
  },
  async findTemplate(id) {
    if (!Types.ObjectId.isValid(id)) return null;
    const template = await ContractTemplate.findOne({
      _id: id,
      deletedAt: null,
    })
      .select("label slug deletedAt")
      .lean();
    if (!template) return null;
    return {
      _id: String(template._id),
      label: template.label,
      slug: template.slug,
      deletedAt: template.deletedAt,
    };
  },
  async findCustomerContracts(customer) {
    const contracts = await Contract.find({
      temporary: { $ne: true },
      $or: [{ customerRef: customer.customerRef }, { customerId: customer.customerId }],
    })
      .select("_id templateId sourceWorkOrderRef equipmentRef temporary")
      .lean();
    return contracts.map((contract) => ({
      _id: String(contract._id),
      templateId: contract.templateId ? String(contract.templateId) : null,
      sourceWorkOrderRef: contract.sourceWorkOrderRef
        ? String(contract.sourceWorkOrderRef)
        : null,
      equipmentRef: contract.equipmentRef ? String(contract.equipmentRef) : null,
      temporary: Boolean(contract.temporary),
    }));
  },
  async createContract(input) {
    const contractDate = input.contractDate;
    const created = await Contract.create({
      customerId: input.customerId,
      customerRef: storedRef(input.customerRef),
      addressRef: input.addressRef ? storedRef(input.addressRef) : null,
      equipmentRef: input.equipmentRef ? storedRef(input.equipmentRef) : null,
      templateId: storedRef(input.templateId),
      originalContractDate: contractDate,
      contractDate,
      durationMonths: input.durationMonths,
      renewalDueDate: computeInitialRenewalDueDate(
        contractDate,
        input.durationMonths,
      ),
      lastRenewalDate: null,
      renewals: [],
      description: input.description,
      contractType: input.contractType,
      sourceWorkOrderRef: storedRef(input.sourceWorkOrderRef),
      userId: input.userId,
      temporary: false,
    });
    return { _id: String(created._id) };
  },
};

export async function enrollAgreementsFromWorkOrder(
  workOrder: EnrollableWorkOrder,
  deps: AgreementEnrollmentDeps = defaultDeps,
): Promise<boolean> {
  const workOrderId = idString(workOrder._id);
  if (!workOrderId) return false;
  const lines = (workOrder.parts ?? []).filter(
    (line) => line.lineType === "agreement" && idString(line.contractTemplateRef),
  );
  if (lines.length === 0) return false;

  const customerRef = await deps.resolveCustomerRef(workOrder);
  if (!customerRef || !workOrder.customerId) return false;

  const contracts = await deps.findCustomerContracts({
    customerId: workOrder.customerId,
    customerRef,
  });
  const equipmentRef = idString(workOrder.equipmentRef);
  const addressRef = idString(workOrder.addressRef);
  let changed = false;

  for (const line of lines) {
    const templateId = idString(line.contractTemplateRef);
    if (!templateId) continue;
    const template = await deps.findTemplate(templateId);
    if (!template || template.deletedAt) continue;

    const decision = decideAgreementEnrollment({
      templateId,
      enrolledContractRef: idString(line.enrolledContractRef),
      workOrderId,
      equipmentRef,
      contracts,
    });

    let contractId = decision.action === "link" ? decision.contractId : "";
    if (decision.action === "create") {
      const contractDate =
        parseDateOnly(workOrder.date ?? null) ?? parseDateOnly(new Date());
      const created = await deps.createContract({
        customerId: workOrder.customerId,
        customerRef,
        addressRef,
        equipmentRef,
        templateId,
        description: template.label,
        contractType: template.slug,
        durationMonths: DEFAULT_DURATION_MONTHS,
        contractDate,
        sourceWorkOrderRef: workOrderId,
        userId: workOrder.userId,
      });
      contractId = created._id;
      contracts.push({
        _id: contractId,
        templateId,
        sourceWorkOrderRef: workOrderId,
        equipmentRef,
        temporary: false,
      });
    }

    if (!contractId || idString(line.enrolledContractRef) === contractId) continue;
    line.enrolledContractRef = storedRef(contractId);
    changed = true;
  }

  if (changed) workOrder.markModified?.("parts");
  return changed;
}

export async function saveWorkOrderAgreements(
  workOrder: EnrollableWorkOrder,
): Promise<void> {
  try {
    const changed = await enrollAgreementsFromWorkOrder(workOrder);
    if (changed && workOrder.save) await workOrder.save();
  } catch (err) {
    console.error("enrollAgreementsFromWorkOrder failed:", err);
  }
}
