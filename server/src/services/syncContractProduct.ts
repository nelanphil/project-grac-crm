import { Types } from "mongoose";
import {
  ContractTemplate,
  slugifyLabel,
  uniqueSlug,
} from "../models/mongo/ContractTemplate";
import { IProduct } from "../models/mongo/Product";
import { normalizeProductDiscounts } from "../utils/productDiscounts";

function desiredSlug(product: IProduct): string {
  return (
    slugifyLabel(product.productCode || product.partNumber || product.name || "") ||
    "contract"
  );
}

/**
 * Keep a ContractTemplate aligned with a contract product.
 * Changing the product away from Contract leaves the template in place.
 */
export async function syncContractTemplateForProduct(
  product: IProduct,
): Promise<void> {
  if (product.kind !== "contract") return;

  const label = product.name.trim() || product.productCode || "Contract";
  const cost = Math.max(0, Number(product.listPrice) || 0);
  const body = product.agreementBody ?? "";
  const productDiscounts = normalizeProductDiscounts(product.productDiscounts);
  const slug = desiredSlug(product);

  const linkedId = product.contractTemplateRef
    ? String(product.contractTemplateRef)
    : "";
  let template =
    linkedId && Types.ObjectId.isValid(linkedId)
      ? await ContractTemplate.findById(linkedId)
      : null;

  if (!template) {
    template = await ContractTemplate.create({
      label,
      slug: await uniqueSlug(slug),
      body,
      cost,
      badgeIcon: "scroll-text",
      productDiscounts,
      deletedAt: null,
    });
    product.contractTemplateRef = template._id;
    await product.save();
    return;
  }

  template.label = label;
  template.body = body;
  template.cost = cost;
  template.productDiscounts = productDiscounts;
  template.deletedAt = null;
  if (template.slug !== slug) {
    const taken = await ContractTemplate.exists({
      slug,
      _id: { $ne: template._id },
    });
    if (!taken) template.slug = slug;
  }
  await template.save();
}

export async function linkedContractTemplateIds(): Promise<Types.ObjectId[]> {
  const { Product } = await import("../models/mongo/Product");
  const products = await Product.find({
    contractTemplateRef: { $ne: null },
  })
    .select("contractTemplateRef")
    .lean();
  return products
    .map((product) => product.contractTemplateRef)
    .filter((id): id is Types.ObjectId => Boolean(id));
}
