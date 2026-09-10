import { Response } from "express";

export type SseLevel = "info" | "warn" | "error" | "ok";

type RequestLike = { headers: { accept?: string } };

export function wantsSse(req: RequestLike): boolean {
  return (req.headers.accept ?? "").includes("text/event-stream");
}

export function initSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  const flushable = res as Response & { flush?: () => void };
  flushable.flush?.();
}

export function sseLog(
  res: Response,
  message: string,
  level: SseLevel = "info",
): void {
  sendSse(res, "log", {
    ts: new Date().toISOString(),
    level,
    message,
  });
}

export function endSse(res: Response): void {
  sendSse(res, "done", {});
  res.end();
}
