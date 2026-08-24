/**
 * Backfills product catalog codes and pricing fields.
 * Run: npx tsx src/scripts/migrate-product-catalog-fields.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Product } from "../models/mongo/Product";
import { buildProductAltCode, normalizeProductCode } from "../utils/productCodes";

async function main(): Promise<void> {
  await connectMongoDB();

  const products = await Product.find().lean();
  console.log(`Found ${products.length} products.`);

  let updated = 0;

  for (const product of products) {
    const productCode = normalizeProductCode(
      product.productCode || product.partNumber || "",
    );
    if (!productCode) continue;

    const listPrice = Number(product.listPrice ?? product.unitPrice ?? 0);
    const productAltCode = buildProductAltCode(productCode);
    const kind = product.kind === "labor" ? "labor" : "part";
    const cost = Number(product.cost ?? 0);
    const strikeThroughPrice = Number(product.strikeThroughPrice ?? 0);
    const productNumber = product.productNumber ?? "";

    const needsUpdate =
      product.productCode !== productCode ||
      product.partNumber !== productCode ||
      product.productAltCode !== productAltCode ||
      product.kind !== kind ||
      product.listPrice !== listPrice ||
      product.unitPrice !== listPrice ||
      product.cost !== cost ||
      product.strikeThroughPrice !== strikeThroughPrice ||
      product.productNumber !== productNumber;

    if (!needsUpdate) continue;

    await Product.findByIdAndUpdate(product._id, {
      $set: {
        productCode,
        partNumber: productCode,
        productAltCode,
        productNumber,
        kind,
        listPrice,
        unitPrice: listPrice,
        cost,
        strikeThroughPrice,
      },
    });
    updated++;
  }

  console.log(`Updated ${updated} products.`);
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
