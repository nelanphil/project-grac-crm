import mongoose from "mongoose";
import app from "./app";
import { env } from "./config/env";
import { connectMongoDB, disconnectMongoDB } from "./config/mongodb";
import { ensureCustomerOptionalUniqueIndexes } from "./models/mongo/Customer";
import {
  seedDefaultPermissions,
  revokeCustomerListAccess,
  ensureContractPermissions,
  ensureIntegrationsPermissions,
  ensureMessagesPermissions,
  ensureTasksPermissions,
  ensureEstimatePermissions,
  ensureProductPermissions,
  ensureDiscountPermissions,
  ensureJobRolePermissions,
  ensureNavPermissions,
} from "./models/mongo/RolePermission";
import { seedDefaultRoles } from "./models/mongo/Role";
import { seedDefaultJobRoles } from "./models/mongo/JobRole";
import {
  ensureFieldStaffPermissions,
  migrateToJobRoles,
} from "./utils/migrateUserRoles";
import { seedDefaultManufacturers } from "./models/mongo/Manufacturer";
import { seedContractTemplates } from "./models/mongo/ContractTemplate";
import { seedInvoiceTemplates } from "./models/mongo/InvoiceTemplate";
import { seedServiceAreas } from "./models/mongo/ServiceArea";
import { ensureTwilioPhoneLineShape } from "./models/mongo/TwilioAccount";
import { startRenewalInvoiceScheduler } from "./jobs/scheduler";
import { startDevTunnelSync, stopDevTunnelSync } from "./services/devTunnel.service";
import { startMailboxIdle, stopMailboxIdle } from "./services/mailboxIdle";
import { applyCompanyTaxRateToOpenDocuments } from "./services/taxSettings";

async function bootstrap(): Promise<void> {
  await connectMongoDB();
  await ensureCustomerOptionalUniqueIndexes(mongoose.connection);
  await seedDefaultRoles();
  await seedDefaultJobRoles();
  await migrateToJobRoles();
  await ensureFieldStaffPermissions();
  await seedDefaultPermissions();
  await revokeCustomerListAccess();
  await ensureContractPermissions();
  await ensureIntegrationsPermissions();
  await ensureMessagesPermissions();
  await ensureTasksPermissions();
  await ensureEstimatePermissions();
  await ensureProductPermissions();
  await ensureDiscountPermissions();
  await ensureJobRolePermissions();
  await ensureNavPermissions();
  await seedDefaultManufacturers();
  await seedContractTemplates();
  await seedInvoiceTemplates();
  await seedServiceAreas();
  await ensureTwilioPhoneLineShape();
  const taxUpdated = await applyCompanyTaxRateToOpenDocuments();
  if (taxUpdated > 0) {
    console.log(`Applied company tax rate to ${taxUpdated} open documents`);
  }

  startRenewalInvoiceScheduler();
  startMailboxIdle();
  startDevTunnelSync();

  const server = app.listen(env.port, () => {
    console.log(`Server running on http://localhost:${env.port}`);
  });

  const shutdown = async () => {
    console.log("Shutting down...");
    stopMailboxIdle();
    stopDevTunnelSync();
    server.close();
    await disconnectMongoDB();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
