import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import routes from "./routes";
import twilioWebhookRoutes from "./routes/twilioWebhook.routes";
import paymentWebhookRoutes from "./routes/paymentWebhook.routes";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { requireSourceMapToken } from "./middleware/sourceMapUpload";

const app = express();
app.set("trust proxy", 1);
app.use(requestId);

// Normalize allowed origins: strip trailing slashes and support a
// comma-separated list in CLIENT_URL. The browser's Origin header never
// includes a trailing slash, so an exact match against a value like
// "https://example.com/" would fail.
const allowedOrigins = new Set(
  env.clientUrl
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (no Origin header) and allowed origins.
      if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ""))) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    exposedHeaders: ["X-Request-Id"],
  }),
);

// Twilio webhooks post application/x-www-form-urlencoded; mount before JSON parser.
app.use(
  "/webhooks/twilio",
  express.urlencoded({ extended: false }),
  twilioWebhookRoutes,
);

// Payment webhooks need raw body for signature verification.
app.use(
  "/webhooks/payments",
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
  paymentWebhookRoutes,
);

// Larger bodies for crash reports and source map uploads; body-parser skips
// already-parsed requests, so the global parser below leaves these alone.
app.use(
  "/crash-reports/sourcemaps",
  requireSourceMapToken,
  express.json({ limit: "60mb" }),
);
app.use("/crash-reports", express.json({ limit: "1mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(routes);

app.use(errorHandler);

export default app;
