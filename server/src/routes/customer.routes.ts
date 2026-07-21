import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  checkEquipmentSerial,
  createCustomer,
  createCustomerAddress,
  createCustomerContact,
  createEquipment,
  deleteCustomerAddress,
  deleteCustomerContact,
  deleteEquipment,
  getCustomerAddresses,
  getCustomerById,
  getCustomerContacts,
  getCustomerDuplicates,
  getMergePreview,
  listCustomers,
  mergeCustomers,
  restoreCustomer,
  softDeleteCustomer,
  updateCustomerAddress,
  updateCustomerContact,
  updateEquipment,
  validateCustomerAddress,
} from "../controllers/customer.controller";
import {
  getCustomerNotes,
  createCustomerNote,
  updateCustomerNote,
  deleteCustomerNote,
} from "../controllers/customerNote.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin", "owner");

router.use(authenticate);

// List + duplicate discovery (static paths before :id)
router.get("/", requirePermission("customers:read"), listCustomers);
router.post("/", adminRoles, createCustomer);
router.post("/validate-address", adminRoles, validateCustomerAddress);
router.get(
  "/duplicates",
  requirePermission("customers:read"),
  getCustomerDuplicates,
);

// Notes
router.get("/:id/notes", requirePermission("customers:read"), getCustomerNotes);
router.post(
  "/:id/notes",
  requirePermission("customers:read"),
  createCustomerNote,
);
router.patch(
  "/:id/notes/:noteId",
  requirePermission("customers:read"),
  updateCustomerNote,
);
router.delete(
  "/:id/notes/:noteId",
  requirePermission("customers:read"),
  deleteCustomerNote,
);

// Sites / equipment
router.get(
  "/:id/addresses",
  requirePermission("customers:read"),
  getCustomerAddresses,
);
router.post(
  "/:id/addresses",
  requirePermission("customers:write"),
  createCustomerAddress,
);
router.patch(
  "/:id/addresses/:addressId",
  requirePermission("customers:write"),
  updateCustomerAddress,
);
router.delete(
  "/:id/addresses/:addressId",
  requirePermission("customers:write"),
  deleteCustomerAddress,
);

router.get(
  "/:id/equipment/check-serial",
  requirePermission("customers:read"),
  checkEquipmentSerial,
);
router.post(
  "/:id/equipment",
  requirePermission("customers:write"),
  createEquipment,
);
router.patch(
  "/:id/equipment/:equipmentId",
  requirePermission("customers:write"),
  updateEquipment,
);
router.delete(
  "/:id/equipment/:equipmentId",
  requirePermission("customers:write"),
  deleteEquipment,
);

// Contacts
router.get(
  "/:id/contacts",
  requirePermission("customers:read"),
  getCustomerContacts,
);
router.post(
  "/:id/contacts",
  requirePermission("customers:write"),
  createCustomerContact,
);
router.patch(
  "/:id/contacts/:contactId",
  requirePermission("customers:write"),
  updateCustomerContact,
);
router.delete(
  "/:id/contacts/:contactId",
  requirePermission("customers:write"),
  deleteCustomerContact,
);

// Merge
router.get(
  "/:id/merge-preview",
  requirePermission("customers:write"),
  getMergePreview,
);
router.post("/:id/merge", requirePermission("customers:write"), mergeCustomers);

// Soft delete / restore (admin roles)
router.post("/:id/restore", adminRoles, restoreCustomer);
router.delete("/:id", adminRoles, softDeleteCustomer);

// Detail (must be last among /:id routes that are exact)
router.get("/:id", requirePermission("customers:read"), getCustomerById);

export default router;
