import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  getInspectDocument,
  InspectError,
  isDatabaseInspectTarget,
  listDatabaseOverviews,
  listInspectCollections,
  listInspectDocuments,
  parseDocumentPaging,
} from "../services/databaseInspect";

function handleInspectError(res: Response, err: unknown): void {
  if (err instanceof InspectError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Database inspect failed.";
  res.status(500).json({ message });
}

export async function listDatabases(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const databases = await listDatabaseOverviews();
    res.json({ databases });
  } catch (err) {
    handleInspectError(res, err);
  }
}

export async function listCollections(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const target = String(req.params.target ?? "");
  if (!isDatabaseInspectTarget(target)) {
    res.status(400).json({ message: "Unknown database target." });
    return;
  }
  try {
    const result = await listInspectCollections(target);
    res.json(result);
  } catch (err) {
    handleInspectError(res, err);
  }
}

export async function listDocuments(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const target = String(req.params.target ?? "");
  const name = String(req.params.name ?? "");
  if (!isDatabaseInspectTarget(target)) {
    res.status(400).json({ message: "Unknown database target." });
    return;
  }
  const { limit, skip } = parseDocumentPaging(req.query.limit, req.query.skip);
  const id =
    typeof req.query.id === "string" && req.query.id.trim()
      ? req.query.id.trim()
      : undefined;
  try {
    const result = await listInspectDocuments(target, name, { limit, skip, id });
    res.json(result);
  } catch (err) {
    handleInspectError(res, err);
  }
}

export async function getDocument(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const target = String(req.params.target ?? "");
  const name = String(req.params.name ?? "");
  const id = String(req.params.id ?? "");
  if (!isDatabaseInspectTarget(target)) {
    res.status(400).json({ message: "Unknown database target." });
    return;
  }
  if (!id) {
    res.status(400).json({ message: "Record id is required." });
    return;
  }
  try {
    const result = await getInspectDocument(target, name, id);
    res.json(result);
  } catch (err) {
    handleInspectError(res, err);
  }
}
