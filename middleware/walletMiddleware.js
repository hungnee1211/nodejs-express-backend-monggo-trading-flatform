import jwt from 'jsonwebtoken';

const auth = function authMiddleware(req, res, next) {
  try {
    // Lấy token từ httpOnly cookie (đã được parse bởi cookie-parser)
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Thiếu token xác thực' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id || payload.userId };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

export default auth;