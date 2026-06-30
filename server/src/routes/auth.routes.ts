import { Router, Response } from "express";
import { login, register, me, updateMe, updatePassword } from "../controllers/auth.controller";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

router.post("/login", login);
router.post("/register", register);
router.get("/me", authenticate, (req, res: Response) => me(req as AuthRequest, res));
router.patch("/me", authenticate, (req, res: Response) => updateMe(req as AuthRequest, res));
router.patch("/me/password", authenticate, (req, res: Response) => updatePassword(req as AuthRequest, res));

export default router;
