import { Router, Request, Response } from "express";
import { getMongoStatus } from "../config/mongodb";
import { getMySQLStatus } from "../config/mysql";
import authRoutes from "./auth.routes";
import leadRoutes from "./lead.routes";
import userRoutes from "./user.routes";
import roleRoutes from "./role.routes";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    mongo: getMongoStatus(),
    mysql: getMySQLStatus(),
  });
});

router.use("/auth", authRoutes);
router.use("/leads", leadRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);

export default router;
