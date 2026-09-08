import express from "express";
import {
  register,
  login,
  googleLogin,
  logout,
  getMe,
} from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleLogin);
router.post("/logout", logout);

// Lấy thông tin user hiện tại từ cookie
router.get("/me", protect, getMe);

export default router;
