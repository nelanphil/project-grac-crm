import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { recordServerError } from "../services/serverErrorCapture.service";

const INCOMING_ID = /^[A-Za-z0-9._:-]{8,100}$/;

export type RequestWithId = Request & { requestId?: string };

type Recorder = typeof recordServerError;

/**
 * Tags each request with an `X-Request-Id` and records any 5xx response that
 * was not already captured by `errorHandler` (controllers that catch their own
 * errors and reply with a 500 directly).
 */
export function createRequestId(record: Recorder = recordServerError) {
  return function requestId(
    req: RequestWithId,
    res: Response,
    next: NextFunction,
  ): void {
    const incoming = req.get("x-request-id");
    const id = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-Id", id);

    const originalJson = res.json.bind(res);
    res.json = (body?: unknown) => {
      if (res.statusCode >= 500 && body && typeof body === "object") {
        const fields = body as Record<string, unknown>;
        const message = fields.message ?? fields.error;
        if (typeof message === "string") res.locals.errorMessage = message;
      }
      return originalJson(body);
    };

    res.on("finish", () => {
      if (res.statusCode < 500 || res.locals.crashRecorded) return;
      res.locals.crashRecorded = true;
      void record({
        req,
        status: res.statusCode,
        message:
          typeof res.locals.errorMessage === "string"
            ? res.locals.errorMessage
            : undefined,
      });
    });

    next();
  };
}

export const requestId = createRequestId();
