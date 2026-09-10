import mongoose from "mongoose";
import mysql from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { env } from "../config/env";
import {
  describeMongoTarget,
  resolveLegacyDumpUri,
} from "./legacyDumpSync";

export const DATABASE_INSPECT_TARGETS = [
  "production",
  "development",
  "mysql",
] as const;

export type DatabaseInspectTarget = (typeof DATABASE_INSPECT_TARGETS)[number];

export type DatabaseInspectKind = "mongo" | "mysql";

export type DatabaseOverview = {
  id: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  label: string | null;
  status: "connected" | "disconnected" | "unavailable";
  reason?: string;
  collectionCount?: number;
};

export type DatabaseCollectionInfo = {
  name: string;
  count: number;
};

export type DatabaseCollectionsResult = {
  target: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  label: string;
  collections: DatabaseCollectionInfo[];
};

export type DatabaseDocumentsPage = {
  target: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  name: string;
  documents: Record<string, unknown>[];
  total: number;
  limit: number;
  skip: number;
};

export type DatabaseDocumentResult = {
  target: DatabaseInspectTarget;
  kind: DatabaseInspectKind;
  name: string;
  document: Record<string, unknown>;
};

export class InspectError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "InspectError";
  }
}

export const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;
export const MAX_DOCUMENT_LIMIT = 50;
export const DEFAULT_DOCUMENT_LIMIT = 25;

const SENSITIVE_KEY =
  /password|secret|token|apikey|api_key|encryption|encrypted|credentials|refreshtoken|refresh_token|privatekey|private_key/i;

const MONGO_TIMEOUT_MS = 5000;
const MYSQL_TIMEOUT_MS = 3000;

export function isDatabaseInspectTarget(
  value: string,
): value is DatabaseInspectTarget {
  return (DATABASE_INSPECT_TARGETS as readonly string[]).includes(value);
}

export function assertSafeIdentifier(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new InspectError(400, "Invalid collection or table name.");
  }
  return name;
}

export function parseDocumentPaging(
  rawLimit: unknown,
  rawSkip: unknown,
): { limit: number; skip: number } {
  const parsedLimit = Number(rawLimit);
  const parsedSkip = Number(rawSkip);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(MAX_DOCUMENT_LIMIT, Math.max(1, Math.trunc(parsedLimit)))
    : DEFAULT_DOCUMENT_LIMIT;
  const skip = Number.isFinite(parsedSkip)
    ? Math.max(0, Math.trunc(parsedSkip))
    : 0;
  return { limit, skip };
}

export function redactValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "***";
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec._bsontype === "string") return String(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return value;
}

function serializeThenRedact(value: unknown): unknown {
  const serialized = JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v && typeof v === "object" && typeof v._bsontype === "string") {
        return String(v);
      }
      return v;
    }),
  );
  return redactValue(serialized);
}

function redactDocument(value: unknown): Record<string, unknown> {
  const redacted = serializeThenRedact(value);
  if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
    return redacted as Record<string, unknown>;
  }
  return { value: redacted };
}

function mysqlLabel(): string {
  return `${env.mysql.host}:${env.mysql.port}/${env.mysql.database}`;
}

function mongoUnavailableReason(target: "production" | "development"): string {
  return target === "production"
    ? "MONGODB_URI_PRODUCTION is not set"
    : "MONGODB_URI_DEVELOPMENT is not set";
}

async function withMongo<T>(
  target: "production" | "development",
  fn: (db: mongoose.mongo.Db) => Promise<T>,
): Promise<T> {
  const uri = resolveLegacyDumpUri(target);
  if (!uri) {
    throw new InspectError(400, mongoUnavailableReason(target));
  }
  const conn = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: MONGO_TIMEOUT_MS,
  });
  try {
    await conn.asPromise();
    const db = conn.db;
    if (!db) {
      throw new InspectError(502, `Could not open the ${target} database.`);
    }
    return await fn(db);
  } catch (err) {
    if (err instanceof InspectError) throw err;
    throw new InspectError(
      502,
      err instanceof Error ? err.message : `Could not connect to ${target}.`,
    );
  } finally {
    await conn.close();
  }
}

async function withMysql<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
  let connection: Connection | null = null;
  try {
    connection = await mysql.createConnection({
      host: env.mysql.host,
      port: env.mysql.port,
      user: env.mysql.user,
      password: env.mysql.password,
      database: env.mysql.database,
      connectTimeout: MYSQL_TIMEOUT_MS,
    });
    return await fn(connection);
  } catch (err) {
    if (err instanceof InspectError) throw err;
    throw new InspectError(
      502,
      err instanceof Error ? err.message : "Could not connect to MySQL.",
    );
  } finally {
    await connection?.end();
  }
}

async function listMongoCollectionNames(
  db: mongoose.mongo.Db,
): Promise<string[]> {
  const listed = await db.listCollections({}, { nameOnly: true }).toArray();
  return listed
    .map((item) => item.name)
    .filter((name) => !name.startsWith("system.") && IDENTIFIER_PATTERN.test(name))
    .sort((a, b) => a.localeCompare(b));
}

async function assertMongoCollection(
  db: mongoose.mongo.Db,
  name: string,
): Promise<void> {
  assertSafeIdentifier(name);
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) {
    throw new InspectError(404, `Collection "${name}" was not found.`);
  }
}

async function listMysqlTableNames(connection: Connection): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [env.mysql.database],
  );
  return rows
    .map((row) => String(row.name))
    .filter((name) => IDENTIFIER_PATTERN.test(name));
}

async function assertMysqlTable(
  connection: Connection,
  name: string,
): Promise<void> {
  assertSafeIdentifier(name);
  const tables = await listMysqlTableNames(connection);
  if (!tables.includes(name)) {
    throw new InspectError(404, `Table "${name}" was not found.`);
  }
}

function quoteMysqlIdent(name: string): string {
  return `\`${name}\``;
}

async function mysqlTableCount(
  connection: Connection,
  name: string,
): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ${quoteMysqlIdent(name)}`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function mysqlPrimaryKey(
  connection: Connection,
  table: string,
): Promise<string | null> {
  const [keys] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION`,
    [env.mysql.database, table],
  );
  if (keys.length === 1) return String(keys[0].name);
  if (keys.length > 1) return String(keys[0].name);
  const [idCol] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'id'`,
    [env.mysql.database, table],
  );
  return idCol.length > 0 ? "id" : null;
}

function mongoIdFilter(id: string): Record<string, unknown> {
  if (
    mongoose.Types.ObjectId.isValid(id) &&
    String(new mongoose.Types.ObjectId(id)) === id
  ) {
    return { _id: new mongoose.Types.ObjectId(id) };
  }
  return { _id: id };
}

async function listMongoCollections(
  target: "production" | "development",
): Promise<DatabaseCollectionsResult> {
  const uri = resolveLegacyDumpUri(target);
  if (!uri) {
    throw new InspectError(400, mongoUnavailableReason(target));
  }
  const label = describeMongoTarget(uri);
  return withMongo(target, async (db) => {
    const names = await listMongoCollectionNames(db);
    const collections = await Promise.all(
      names.map(async (name) => ({
        name,
        count: await db.collection(name).estimatedDocumentCount(),
      })),
    );
    return { target, kind: "mongo", label, collections };
  });
}

async function listMysqlCollections(): Promise<DatabaseCollectionsResult> {
  return withMysql(async (connection) => {
    const names = await listMysqlTableNames(connection);
    const collections = await Promise.all(
      names.map(async (name) => ({
        name,
        count: await mysqlTableCount(connection, name),
      })),
    );
    return {
      target: "mysql",
      kind: "mysql",
      label: mysqlLabel(),
      collections,
    };
  });
}

async function overviewMongo(
  target: "production" | "development",
): Promise<DatabaseOverview> {
  const uri = resolveLegacyDumpUri(target);
  if (!uri) {
    return {
      id: target,
      kind: "mongo",
      label: null,
      status: "unavailable",
      reason: mongoUnavailableReason(target),
    };
  }
  const label = describeMongoTarget(uri);
  try {
    const collectionCount = await withMongo(
      target,
      async (db) => (await listMongoCollectionNames(db)).length,
    );
    return {
      id: target,
      kind: "mongo",
      label,
      status: "connected",
      collectionCount,
    };
  } catch (err) {
    return {
      id: target,
      kind: "mongo",
      label,
      status: "disconnected",
      reason: err instanceof Error ? err.message : "Connection failed.",
    };
  }
}

async function overviewMysql(): Promise<DatabaseOverview> {
  const label = mysqlLabel();
  try {
    const collectionCount = await withMysql(
      async (connection) => (await listMysqlTableNames(connection)).length,
    );
    return {
      id: "mysql",
      kind: "mysql",
      label,
      status: "connected",
      collectionCount,
    };
  } catch (err) {
    return {
      id: "mysql",
      kind: "mysql",
      label,
      status: "disconnected",
      reason: err instanceof Error ? err.message : "Connection failed.",
    };
  }
}

export async function listDatabaseOverviews(): Promise<DatabaseOverview[]> {
  const [production, development, mysqlOverview] = await Promise.all([
    overviewMongo("production"),
    overviewMongo("development"),
    overviewMysql(),
  ]);
  return [production, development, mysqlOverview];
}

export async function listInspectCollections(
  target: DatabaseInspectTarget,
): Promise<DatabaseCollectionsResult> {
  if (target === "mysql") return listMysqlCollections();
  return listMongoCollections(target);
}

export async function listInspectDocuments(
  target: DatabaseInspectTarget,
  name: string,
  options: { limit: number; skip: number; id?: string },
): Promise<DatabaseDocumentsPage> {
  const { limit, skip, id } = options;
  if (target === "mysql") {
    return withMysql(async (connection) => {
      await assertMysqlTable(connection, name);
      const quoted = quoteMysqlIdent(name);
      if (id) {
        const pk = await mysqlPrimaryKey(connection, name);
        if (!pk) {
          throw new InspectError(
            400,
            `Table "${name}" has no usable primary key for lookup.`,
          );
        }
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT * FROM ${quoted} WHERE ${quoteMysqlIdent(pk)} = ? LIMIT 1`,
          [id],
        );
        const documents = rows.map((row) => redactDocument(row));
        return {
          target,
          kind: "mysql",
          name,
          documents,
          total: documents.length,
          limit,
          skip: 0,
        };
      }
      const total = await mysqlTableCount(connection, name);
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT * FROM ${quoted} LIMIT ? OFFSET ?`,
        [limit, skip],
      );
      return {
        target,
        kind: "mysql",
        name,
        documents: rows.map((row) => redactDocument(row)),
        total,
        limit,
        skip,
      };
    });
  }

  return withMongo(target, async (db) => {
    await assertMongoCollection(db, name);
    const collection = db.collection(name);
    const filter = id ? mongoIdFilter(id) : {};
    const total = await collection.countDocuments(filter);
    const rows = await collection.find(filter).skip(skip).limit(limit).toArray();
    return {
      target,
      kind: "mongo",
      name,
      documents: rows.map((row) => redactDocument(row)),
      total,
      limit,
      skip: id ? 0 : skip,
    };
  });
}

export async function getInspectDocument(
  target: DatabaseInspectTarget,
  name: string,
  id: string,
): Promise<DatabaseDocumentResult> {
  const page = await listInspectDocuments(target, name, {
    limit: 1,
    skip: 0,
    id,
  });
  const document = page.documents[0];
  if (!document) {
    throw new InspectError(404, "Record not found.");
  }
  return { target, kind: page.kind, name, document };
}
