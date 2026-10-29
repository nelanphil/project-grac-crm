import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  LOG_CHANNELS,
  type LogChannel,
  type LogDirection,
  loadCommunicationLog,
} from "../services/communicationLog.service";

const PAGE_SIZES = new Set([25, 50, 100]);
const MAX_RANGE_MS = 93 * 24 * 60 * 60 * 1000;

function isChannel(value: string): value is LogChannel {
  return (LOG_CHANNELS as readonly string[]).includes(value);
}

// GET /communications-log
export async function getCommunicationLog(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const from = new Date(String(req.query.from ?? ""));
    const to = new Date(String(req.query.to ?? ""));
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() >= to.getTime()
    ) {
      res.status(400).json({ message: "A valid from and to range is required" });
      return;
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      res.status(400).json({ message: "Date range is too large" });
      return;
    }

    const channelRaw = String(req.query.channel ?? "");
    if (channelRaw && !isChannel(channelRaw)) {
      res.status(400).json({ message: "Invalid channel filter" });
      return;
    }
    const directionRaw = String(req.query.direction ?? "");
    if (
      directionRaw &&
      directionRaw !== "inbound" &&
      directionRaw !== "outbound"
    ) {
      res.status(400).json({ message: "Invalid direction filter" });
      return;
    }

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSizeRaw = parseInt(String(req.query.pageSize ?? "25"), 10) || 25;
    const pageSize = PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 25;
    const repliedOnly =
      req.query.repliedOnly === "true" || req.query.replied === "true";

    const result = await loadCommunicationLog({
      from,
      to,
      channel: channelRaw as LogChannel | "",
      direction: directionRaw as LogDirection | "",
      repliedOnly,
      search: String(req.query.search ?? ""),
      page,
      pageSize,
    });
    res.json(result);
  } catch (err) {
    console.error("GET /communications-log error:", err);
    res.status(500).json({ message: "Failed to load the communications log" });
  }
}
