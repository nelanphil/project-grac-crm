/**
 * One-time introspection script — prints the schema of the `customer` table
 * from the genmaintfl_core MySQL database.
 *
 * Run: npx tsx src/scripts/inspect-customer-schema.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMySQL, getMySQLPool, disconnectMySQL } from "../config/mysql";

async function main() {
  await connectMySQL();
  const pool = getMySQLPool();
  if (!pool)
    throw new Error("MySQL pool unavailable — check connection settings");

  console.log("\n=== DESCRIBE customer ===\n");
  const [columns] = await pool.query("DESCRIBE customer");
  console.table(columns);

  console.log("\n=== Sample row (LIMIT 1) ===\n");
  const [rows] = await pool.query("SELECT * FROM customer LIMIT 1");
  console.log(JSON.stringify(rows, null, 2));

  console.log("\n=== Row count ===\n");
  const [countResult] = await pool.query(
    "SELECT COUNT(*) AS total FROM customer",
  );
  console.log(countResult);

  await disconnectMySQL();
}

main().catch((err) => {
  console.error("Introspection failed:", err);
  process.exit(1);
});
