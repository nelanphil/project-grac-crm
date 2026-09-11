import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  getDocument,
  listCollections,
  listDatabases,
  listDocuments,
} from "../controllers/databaseInspect.controller";

const router = Router();

router.use(authenticate, requireRole("super-admin"));

router.get("/", listDatabases);
router.get("/:target/collections", listCollections);
router.get("/:target/collections/:name/documents", listDocuments);
router.get("/:target/collections/:name/documents/:id", getDocument);

export default router;
