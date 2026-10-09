import assert from "node:assert/strict";
import { Types } from "mongoose";
import { describe, it } from "node:test";
import {
  enrollAgreementsFromWorkOrder,
  type AgreementContractRecord,
  type AgreementEnrollmentDeps,
  type EnrollableWorkOrder,
  type NewAgreementContract,
} from "./enrollTicketAgreements";

const TEMPLATE = "64b0f2c2a1b2c3d4e5f60711";
const OTHER_TEMPLATE = "64b0f2c2a1b2c3d4e5f60712";
const WORK_ORDER = "64b0f2c2a1b2c3d4e5f60722";
const EQUIPMENT = "64b0f2c2a1b2c3d4e5f60733";
const OTHER_EQUIPMENT = "64b0f2c2a1b2c3d4e5f60734";
const CUSTOMER = "64b0f2c2a1b2c3d4e5f60744";
const EXISTING = "64b0f2c2a1b2c3d4e5f60755";

function harness(seed: AgreementContractRecord[] = []) {
  const contracts = seed.map((contract) => ({ ...contract }));
  const created: NewAgreementContract[] = [];
  const deps: AgreementEnrollmentDeps = {
    resolveCustomerRef: async () => CUSTOMER,
    findTemplate: async (id) => {
      if (id === TEMPLATE) {
        return {
          _id: TEMPLATE,
          label: "Service Contract",
          slug: "service",
          deletedAt: null,
        };
      }
      if (id === OTHER_TEMPLATE) {
        return {
          _id: OTHER_TEMPLATE,
          label: "Platinum Agreement",
          slug: "platinum",
          deletedAt: null,
        };
      }
      return null;
    },
    findCustomerContracts: async () => contracts.map((contract) => ({ ...contract })),
    createContract: async (input) => {
      const _id = new Types.ObjectId().toString();
      created.push(input);
      contracts.push({
        _id,
        templateId: input.templateId,
        sourceWorkOrderRef: input.sourceWorkOrderRef,
        equipmentRef: input.equipmentRef,
        temporary: false,
      });
      return { _id };
    },
  };
  return { contracts, created, deps };
}

function ticket(
  parts: EnrollableWorkOrder["parts"],
  equipmentRef: string | null = EQUIPMENT,
): EnrollableWorkOrder {
  return {
    _id: WORK_ORDER,
    customerId: 42,
    customerRef: CUSTOMER,
    equipmentRef,
    date: "2026-09-30",
    userId: 7,
    parts,
  };
}

function agreement(templateId = TEMPLATE, enrolledContractRef: string | null = null) {
  return {
    lineType: "agreement",
    contractTemplateRef: templateId,
    enrolledContractRef,
    description: "Service Contract",
  };
}

describe("agreement enrollment", () => {
  it("creates one contract on the first save and links that contract on the next save", async () => {
    const { created, deps } = harness();
    const workOrder = ticket([agreement()]);

    const createdNow = await enrollAgreementsFromWorkOrder(workOrder, deps);
    assert.equal(createdNow, true);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.templateId, TEMPLATE);
    assert.equal(created[0]?.sourceWorkOrderRef, WORK_ORDER);
    assert.equal(created[0]?.equipmentRef, EQUIPMENT);
    assert.equal(created[0]?.durationMonths, 12);
    assert.equal(created[0]?.description, "Service Contract");
    assert.equal(created[0]?.contractDate?.toISOString(), "2026-09-30T00:00:00.000Z");

    const again = await enrollAgreementsFromWorkOrder(workOrder, deps);
    assert.equal(again, false);
    assert.equal(created.length, 1);
  });

  it("enrolls once when an estimate is converted and the new work order is saved again", async () => {
    const { created, deps } = harness();
    const converted = ticket([agreement()]);

    await enrollAgreementsFromWorkOrder(converted, deps);
    await enrollAgreementsFromWorkOrder(converted, deps);

    assert.equal(created.length, 1);
    assert.equal(created[0]?.sourceWorkOrderRef, WORK_ORDER);
  });

  it("links an existing contract on the same equipment instead of creating another", async () => {
    const { created, deps } = harness([
      {
        _id: EXISTING,
        templateId: TEMPLATE,
        sourceWorkOrderRef: null,
        equipmentRef: EQUIPMENT,
        temporary: false,
      },
    ]);
    const workOrder = ticket([agreement()]);

    const changed = await enrollAgreementsFromWorkOrder(workOrder, deps);

    assert.equal(changed, true);
    assert.equal(created.length, 0);
    assert.equal(String(workOrder.parts?.[0]?.enrolledContractRef), EXISTING);
  });

  it("creates a contract when the customer's existing agreement is on different equipment", async () => {
    const { created, deps } = harness([
      {
        _id: EXISTING,
        templateId: TEMPLATE,
        sourceWorkOrderRef: null,
        equipmentRef: OTHER_EQUIPMENT,
        temporary: false,
      },
    ]);

    await enrollAgreementsFromWorkOrder(ticket([agreement()]), deps);

    assert.equal(created.length, 1);
    assert.equal(created[0]?.equipmentRef, EQUIPMENT);
  });

  it("shares one contract across duplicate lines and creates another for a different template", async () => {
    const { created, deps } = harness();
    const workOrder = ticket([agreement(), agreement(OTHER_TEMPLATE), agreement()]);

    await enrollAgreementsFromWorkOrder(workOrder, deps);

    assert.equal(created.length, 2);
    assert.equal(
      String(workOrder.parts?.[0]?.enrolledContractRef),
      String(workOrder.parts?.[2]?.enrolledContractRef),
    );
    assert.notEqual(
      String(workOrder.parts?.[0]?.enrolledContractRef),
      String(workOrder.parts?.[1]?.enrolledContractRef),
    );
  });
});
