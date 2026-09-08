import jwt from "jsonwebtoken";
import User from "../models/users.js";

// Middleware xác thực JWT từ HTTP-only cookie
export const protect = async (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return next(); // Không có token, cho qua nhưng req.user sẽ undefined
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Lấy thông tin user đầy đủ từ DB
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      req.user = null;
      return next();
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    req.user = null;
    next();
  }
};
