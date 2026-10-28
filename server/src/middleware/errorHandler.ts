import { Request, Response, NextFunction } from "express";
import { recordServerError } from "../services/serverErrorCapture.service";
import type { RequestWithId } from "./requestId";

function clientErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const record = err as { status?: unknown; statusCode?: unknown };
  const status =
    typeof record.status === "number" ? record.status : record.statusCode;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : null;
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as RequestWithId).requestId;
  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== null) {
    res.status(clientStatus).json({ message: err.message, requestId });
    return;
  }
  if (err.message?.endsWith("not allowed by CORS")) {
    res.status(403).json({ message: err.message, requestId });
    return;
  }

  console.error(err);
  res.locals.crashRecorded = true;
  void recordServerError({ err, req, status: 500 });
  res.status(500).json({ error: "Internal server error", requestId });
}
