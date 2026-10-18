import { Router, Response } from "express";
import { streamDashboardLive } from "../controllers/dashboardLive.controller";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

router.get("/live", authenticate, (req, res: Response) => {
  streamDashboardLive(req as AuthRequest, res);
});

export default router;
