import app from "./app";
import { env } from "./config/env";
import { connectMongoDB, disconnectMongoDB } from "./config/mongodb";
import { seedDefaultPermissions, revokeCustomerListAccess, ensureContractPermissions, ensureIntegrationsPermissions } from "./models/mongo/RolePermission";
import { seedDefaultRoles } from "./models/mongo/Role";
import { seedContractTemplates } from "./models/mongo/ContractTemplate";

async function bootstrap(): Promise<void> {
  await connectMongoDB();
  await seedDefaultRoles();
  await seedDefaultPermissions();
  await revokeCustomerListAccess();
  await ensureContractPermissions();
  await ensureIntegrationsPermissions();
  await seedContractTemplates();

  const server = app.listen(env.port, () => {
    console.log(`Server running on http://localhost:${env.port}`);
  });

  const shutdown = async () => {
    console.log("Shutting down...");
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
