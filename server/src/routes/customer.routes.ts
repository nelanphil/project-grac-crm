import { Router } from "express";
import {
  authenticate,
  requirePermission,
  requireRole,
} from "../middleware/auth.middleware";
import {
  checkCustomerDuplicates,
  checkEquipmentSerial,
  createCustomer,
  createCustomerAddress,
  createCustomerContact,
  createEquipment,
  deleteCustomerAddress,
  deleteCustomerContact,
  detachCustomerContactFromCustomer,
  deleteEquipment,
  getCustomerAddresses,
  getCustomerById,
  getCustomerNotifications,
  getCustomerContacts,
  getCustomerDuplicates,
  getMergePreview,
  listContacts,
  listCustomers,
  mergeCustomers,
  promoteCustomer,
  restoreCustomer,
  softDeleteCustomer,
  updateCustomer,
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
  markCustomerNotesViewed,
  getCustomerAttention,
} from "../controllers/customerNote.controller";
import { getCustomerCheckoutLink } from "../controllers/checkout.controller";
import {
  getCustomerActivity,
  streamCustomerActivity,
} from "../controllers/customerActivity.controller";

const router = Router();

const adminRoles = requireRole("admin", "super-admin");

router.use(authenticate);

// List + duplicate discovery (static paths before :id)
router.get("/", requirePermission("customers:read"), listCustomers);
router.get("/contacts", requirePermission("customers:read"), listContacts);
router.post("/", adminRoles, createCustomer);
router.post("/validate-address", adminRoles, validateCustomerAddress);
router.get(
  "/duplicates",
  requirePermission("customers:read"),
  getCustomerDuplicates,
);
router.post(
  "/check-duplicates",
  requirePermission("customers:read"),
  checkCustomerDuplicates,
);

router.get(
  "/:id/activity/live",
  requirePermission("customers:read"),
  streamCustomerActivity,
);
router.get(
  "/:id/activity",
  requirePermission("customers:read"),
  getCustomerActivity,
);

// Notes
router.get("/:id/notes", requirePermission("customers:read"), getCustomerNotes);
router.post(
  "/:id/notes",
  requirePermission("customers:read"),
  createCustomerNote,
);
router.post(
  "/:id/notes/viewed",
  requirePermission("customers:read"),
  markCustomerNotesViewed,
);
router.get(
  "/:id/attention",
  requirePermission("customers:read"),
  getCustomerAttention,
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
router.post(
  "/:id/contacts/:contactId/detach",
  requirePermission("customers:write"),
  detachCustomerContactFromCustomer,
);

router.get(
  "/:id/checkout-link",
  requirePermission("contracts:write"),
  getCustomerCheckoutLink,
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

// Detail + account name update
router.patch(
  "/:id/promote",
  requirePermission("customers:write"),
  promoteCustomer,
);
router.patch("/:id", requirePermission("customers:write"), updateCustomer);
router.get("/:id/notifications", requirePermission("customers:read"), getCustomerNotifications);
router.get("/:id", requirePermission("customers:read"), getCustomerById);

export default router;
