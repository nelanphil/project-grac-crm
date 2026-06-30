import mysql from "mysql2/promise";
import { env } from "./env";

let pool: mysql.Pool | null = null;
let isConnected = false;

export async function connectMySQL(): Promise<void> {
  try {
    pool = mysql.createPool({
      host: env.mysql.host,
      port: env.mysql.port,
      user: env.mysql.user,
      password: env.mysql.password,
      database: env.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 3000,
    });
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    isConnected = true;
    console.log("MySQL connected");
  } catch (error) {
    pool = null;
    isConnected = false;
    console.warn("MySQL connection failed:", (error as Error).message);
  }
}

export async function disconnectMySQL(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    isConnected = false;
    console.log("MySQL disconnected");
  }
}

export function getMySQLPool(): mysql.Pool | null {
  return pool;
}

export function getMySQLStatus(): "connected" | "disconnected" {
  return isConnected ? "connected" : "disconnected";
}
