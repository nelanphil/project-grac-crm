import { Router, Response } from "express";
import {
  login,
  register,
  me,
  updateMe,
  updateMyNavOrder,
  updatePassword,
  forgotPassword,
  resetPassword,
  checkUsername,
  acceptLegalConsent,
} from "../controllers/auth.controller";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

router.post("/login", login);
router.post("/register", register);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", authenticate, (req, res: Response) =>
  me(req as AuthRequest, res),
);
router.patch("/me", authenticate, (req, res: Response) =>
  updateMe(req as AuthRequest, res),
);
router.patch("/me/nav-order", authenticate, (req, res: Response) =>
  updateMyNavOrder(req as AuthRequest, res),
);
router.patch("/me/password", authenticate, (req, res: Response) =>
  updatePassword(req as AuthRequest, res),
);
router.post("/legal-consent", authenticate, (req, res: Response) =>
  acceptLegalConsent(req as AuthRequest, res),
);
router.get("/username-check", authenticate, (req, res: Response) =>
  checkUsername(req as AuthRequest, res),
);

export default router;
