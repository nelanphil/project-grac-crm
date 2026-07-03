import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { ServiceContract } from "../models/mongo/ServiceContract";
import { Customer } from "../models/mongo/Customer";

async function enrichWithCustomer(
  contracts: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const customerIds = [
    ...new Set(
      contracts
        .map((c) => c.customerRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  const customers = await Customer.find({ _id: { $in: customerIds } })
    .select("_id first last")
    .lean();

  const customerById = new Map(
    customers.map((c) => [c._id.toString(), { _id: c._id, first: c.first, last: c.last }]),
  );

  return contracts.map((c) => ({
    ...c,
    customer: customerById.get(c.customerRef?.toString() ?? "") ?? null,
  }));
}

// GET /contracts?customerId=<legacyId>
export async function getContracts(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const filter: Record<string, unknown> = {};

    if (req.query.customerId) {
      const id = parseInt(req.query.customerId as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ message: "Invalid customerId" });
        return;
      }
      filter.customerId = id;
    }

    const contracts = await ServiceContract.find(filter)
      .sort({ contractDate: -1 })
      .lean();

    const enriched = await enrichWithCustomer(contracts);
    res.json({ contracts: enriched });
  } catch {
    res.status(500).json({ message: "Failed to fetch contracts" });
  }
}

// GET /contracts/:id
export async function getContractById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contract = await ServiceContract.findById(req.params.id).lean();
    if (!contract) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }

    const [enriched] = await enrichWithCustomer([contract]);
    res.json({ contract: enriched });
  } catch {
    res.status(500).json({ message: "Failed to fetch contract" });
  }
}

// POST /contracts
export async function createContract(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const { customerId, contractDate, description } = req.body;
    if (!customerId) {
      res.status(400).json({ message: "customerId is required" });
      return;
    }

    const customer = await Customer.findOne({ legacyId: customerId }).lean();
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const contract = await ServiceContract.create({
      customerId,
      customerRef: customer._id,
      contractDate: contractDate ?? null,
      description: description ?? "",
      userId: req.user ? parseInt(req.user.id, 10) : undefined,
    });

    res.status(201).json({ contract });
  } catch {
    res.status(500).json({ message: "Failed to create contract" });
  }
}

// PATCH /contracts/:id
export async function updateContract(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const { contractDate, description } = req.body;
    const updates: Record<string, unknown> = {};
    if (contractDate !== undefined) updates.contractDate = contractDate;
    if (description !== undefined) updates.description = description;

    const contract = await ServiceContract.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    ).lean();

    if (!contract) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }

    res.json({ contract });
  } catch {
    res.status(500).json({ message: "Failed to update contract" });
  }
}

// DELETE /contracts/:id
export async function deleteContract(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const contract = await ServiceContract.findByIdAndDelete(req.params.id).lean();
    if (!contract) {
      res.status(404).json({ message: "Contract not found" });
      return;
    }
    res.status(204).send();
  } catch {
    res.status(500).json({ message: "Failed to delete contract" });
  }
}
