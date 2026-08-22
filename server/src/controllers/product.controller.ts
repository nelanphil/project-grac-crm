import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { Product, IProduct, ProductKind } from "../models/mongo/Product";
import {
  createProductSchema,
  updateProductSchema,
} from "../schemas/product.schema";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import { buildProductAltCode } from "../utils/productCodes";

function asProductKind(value: unknown): ProductKind {
  return value === "labor" ? "labor" : "part";
}

function toPublic(doc: IProduct | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof (doc as IProduct).toObject === "function"
      ? (doc as IProduct).toObject()
      : (doc as Record<string, unknown>);

  const productCode = String(d.productCode || d.partNumber || "").trim();
  const listPrice = Number(d.listPrice ?? d.unitPrice ?? 0);

  return {
    _id: d._id,
    productCode,
    productNumber: d.productNumber ?? "",
    productAltCode: d.productAltCode || buildProductAltCode(productCode),
    partNumber: d.partNumber || productCode,
    name: d.name,
    kind: asProductKind(d.kind),
    listPrice,
    unitPrice: Number(d.unitPrice ?? listPrice),
    cost: Number(d.cost ?? 0),
    strikeThroughPrice: Number(d.strikeThroughPrice ?? 0),
    active: d.active !== false,
    notes: d.notes ?? "",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function findCodeClash(code: string, excludeId?: string) {
  const filter: Record<string, unknown> = {
    $or: [{ productCode: code }, { partNumber: code }],
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Product.findOne(filter).lean();
}

export async function getProducts(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const activeOnly =
      req.query.active === "1" || req.query.active === "true";

    const filter: Record<string, unknown> = {};
    if (activeOnly) filter.active = true;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { productCode: re },
        { productNumber: re },
        { productAltCode: re },
        { partNumber: re },
        { name: re },
      ];
    }

    const products = await Product.find(filter)
      .sort({ productCode: 1, partNumber: 1 })
      .lean();
    res.json({ products: products.map(toPublic) });
  } catch (err) {
    console.error("GET /products error:", err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
}

export async function getProductById(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) {
      res.status(404).json({ message: "Product not found" });
      return;
    }
    res.json({ product: toPublic(product) });
  } catch (err) {
    console.error("GET /products/:id error:", err);
    res.status(500).json({ message: "Failed to fetch product" });
  }
}

export async function createProduct(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    const productCode = (data.productCode || data.partNumber || "").trim();
    const listPrice = data.listPrice ?? data.unitPrice ?? 0;
    const existing = await findCodeClash(productCode);
    if (existing) {
      res.status(409).json({ message: "A product with that product code already exists" });
      return;
    }

    const product = await Product.create({
      productCode,
      productNumber: data.productNumber ?? "",
      productAltCode: buildProductAltCode(productCode),
      partNumber: productCode,
      name: data.name,
      kind: data.kind ?? "part",
      listPrice,
      unitPrice: listPrice,
      cost: data.cost ?? 0,
      strikeThroughPrice: data.strikeThroughPrice ?? 0,
      active: data.active ?? true,
      notes: data.notes ?? "",
    });

    logNotificationAsync({
      entityType: "product",
      action: "created",
      entityId: String(product._id),
      summary: `Product ${product.productCode} created`,
      metadata: { productCode: product.productCode, partNumber: product.partNumber },
      ...actorFromRequest(req.user),
    });

    res.status(201).json({ product: toPublic(product) });
  } catch (err) {
    console.error("POST /products error:", err);
    res.status(500).json({ message: "Failed to create product" });
  }
}

export async function updateProduct(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      res.status(404).json({ message: "Product not found" });
      return;
    }

    const data = parsed.data;
    const nextCode = (data.productCode || data.partNumber)?.trim();
    if (nextCode && nextCode !== (product.productCode || product.partNumber)) {
      const clash = await findCodeClash(nextCode, String(product._id));
      if (clash) {
        res.status(409).json({ message: "A product with that product code already exists" });
        return;
      }
      product.productCode = nextCode;
      product.partNumber = nextCode;
      product.productAltCode = buildProductAltCode(nextCode);
    } else if (product.productCode) {
      product.partNumber = product.productCode;
      product.productAltCode = buildProductAltCode(product.productCode);
    }

    if (data.productNumber !== undefined) product.productNumber = data.productNumber;
    if (data.name !== undefined) product.name = data.name;
    if (data.kind !== undefined) product.kind = data.kind;
    if (data.listPrice !== undefined || data.unitPrice !== undefined) {
      const listPrice = data.listPrice ?? data.unitPrice ?? product.listPrice;
      product.listPrice = listPrice;
      product.unitPrice = listPrice;
    }
    if (data.cost !== undefined) product.cost = data.cost;
    if (data.strikeThroughPrice !== undefined) {
      product.strikeThroughPrice = data.strikeThroughPrice;
    }
    if (data.active !== undefined) product.active = data.active;
    if (data.notes !== undefined) product.notes = data.notes;

    await product.save();

    logNotificationAsync({
      entityType: "product",
      action: "updated",
      entityId: String(product._id),
      summary: `Product ${product.productCode || product.partNumber} updated`,
      metadata: {
        productCode: product.productCode,
        partNumber: product.partNumber,
      },
      ...actorFromRequest(req.user),
    });

    res.json({ product: toPublic(product) });
  } catch (err) {
    console.error("PATCH /products/:id error:", err);
    res.status(500).json({ message: "Failed to update product" });
  }
}

export async function deleteProduct(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const product = await Product.findByIdAndDelete(req.params.id).lean();
    if (!product) {
      res.status(404).json({ message: "Product not found" });
      return;
    }

    const code = product.productCode || product.partNumber;
    logNotificationAsync({
      entityType: "product",
      action: "deleted",
      entityId: String(product._id),
      summary: `Product ${code} deleted`,
      metadata: { productCode: code, partNumber: product.partNumber },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /products/:id error:", err);
    res.status(500).json({ message: "Failed to delete product" });
  }
}
