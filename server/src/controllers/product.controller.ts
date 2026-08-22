import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { Product, IProduct } from "../models/mongo/Product";
import {
  createProductSchema,
  updateProductSchema,
} from "../schemas/product.schema";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";

function toPublic(doc: IProduct | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof (doc as IProduct).toObject === "function"
      ? (doc as IProduct).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    partNumber: d.partNumber,
    name: d.name,
    unitPrice: d.unitPrice ?? 0,
    active: d.active !== false,
    notes: d.notes ?? "",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
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
      filter.$or = [{ partNumber: re }, { name: re }];
    }

    const products = await Product.find(filter)
      .sort({ partNumber: 1 })
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
    const existing = await Product.findOne({
      partNumber: data.partNumber,
    }).lean();
    if (existing) {
      res.status(409).json({ message: "A product with that part number already exists" });
      return;
    }

    const product = await Product.create({
      partNumber: data.partNumber,
      name: data.name,
      unitPrice: data.unitPrice ?? 0,
      active: data.active ?? true,
      notes: data.notes ?? "",
    });

    logNotificationAsync({
      entityType: "product",
      action: "created",
      entityId: String(product._id),
      summary: `Product ${product.partNumber} created`,
      metadata: { partNumber: product.partNumber },
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
    if (data.partNumber && data.partNumber !== product.partNumber) {
      const clash = await Product.findOne({
        partNumber: data.partNumber,
        _id: { $ne: product._id },
      }).lean();
      if (clash) {
        res.status(409).json({ message: "A product with that part number already exists" });
        return;
      }
      product.partNumber = data.partNumber;
    }
    if (data.name !== undefined) product.name = data.name;
    if (data.unitPrice !== undefined) product.unitPrice = data.unitPrice;
    if (data.active !== undefined) product.active = data.active;
    if (data.notes !== undefined) product.notes = data.notes;

    await product.save();

    logNotificationAsync({
      entityType: "product",
      action: "updated",
      entityId: String(product._id),
      summary: `Product ${product.partNumber} updated`,
      metadata: { partNumber: product.partNumber },
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

    logNotificationAsync({
      entityType: "product",
      action: "deleted",
      entityId: String(product._id),
      summary: `Product ${product.partNumber} deleted`,
      metadata: { partNumber: product.partNumber },
      ...actorFromRequest(req.user),
    });

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /products/:id error:", err);
    res.status(500).json({ message: "Failed to delete product" });
  }
}
