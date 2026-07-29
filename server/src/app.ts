import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import routes from "./routes";
import twilioWebhookRoutes from "./routes/twilioWebhook.routes";
import paymentWebhookRoutes from "./routes/paymentWebhook.routes";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.clientUrl }));

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(routes);

app.use(errorHandler);

export default app;
