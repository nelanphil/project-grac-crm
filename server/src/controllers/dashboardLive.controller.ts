import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { subscribeDashboardLive } from "../services/dashboardLive";
import { isStaffRole } from "../utils/roles";

const HEARTBEAT_MS = 25_000;

export function streamDashboardLive(req: AuthRequest, res: Response): void {
  if (!req.user || !isStaffRole(req.user)) {
    res.status(403).json({ message: "Staff only" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };
  const writeFrame = (chunk: string) => {
    if (closed) return;
    try {
      res.write(chunk);
    } catch {
      close();
    }
  };
  const send = () => {
    writeFrame("event: dashboard\ndata: {}\n\n");
  };
  const unsubscribe = subscribeDashboardLive(send);
  const heartbeat = setInterval(() => {
    writeFrame(": ping\n\n");
  }, HEARTBEAT_MS);
  writeFrame(": connected\n\n");
  req.on("close", close);
}
