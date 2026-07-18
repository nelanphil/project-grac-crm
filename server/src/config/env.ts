import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const isProd = process.env.NODE_ENV === "production";
const DEFAULT_DB = "grac-crm";

function resolveMongoUri(): string {
  const raw =
    (isProd
      ? process.env.MONGODB_URI_PRODUCTION
      : process.env.MONGODB_URI_DEVELOPMENT) ??
    process.env.MONGODB_URI ??
    `mongodb://localhost:27017/${DEFAULT_DB}`;

  if (raw.includes(`/${DEFAULT_DB}`)) return raw;

  const [base, query] = raw.split("?");
  const afterHost = base.replace(/^mongodb(\+srv)?:\/\/[^/]+/, "");
  const needsDb = afterHost === "" || afterHost === "/";

  if (!needsDb) return raw;

  const baseTrimmed = base.replace(/\/$/, "");
  return query ? `${baseTrimmed}/${DEFAULT_DB}?${query}` : `${baseTrimmed}/${DEFAULT_DB}`;
}

export const env = {
  port: parseInt(process.env.PORT || "4009", 10),
  clientUrl: process.env.CLIENT_URL || "http://localhost:3009",
  mongodbUri: resolveMongoUri(),
  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  // AES-256 key for encrypting third-party credentials at rest.
  // Production must set CREDENTIALS_ENCRYPTION_KEY (64-char hex or 32-byte base64).
  credentialsEncryptionKey:
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  mysql: {
    host: process.env.MYSQL_HOST || "localhost",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "grac_crm",
  },
};
