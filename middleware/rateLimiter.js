/**
 * Rate limiter middleware đơn giản dùng in-memory store.
 * Cho production nên dùng Redis (express-rate-limit + rate-limit-redis).
 */

const store = new Map();

/**
 * Tạo middleware rate limiter
 * @param {Object} options
 * @param {number} options.windowMs - Cửa sổ thời gian (ms)
 * @param {number} options.max - Số request tối đa trong window
 * @param {string} options.message - Thông báo lỗi
 * @param {number} options.statusCode - HTTP status code
 * @param {Function} options.keyGenerator - Hàm tạo key (mặc định dùng IP)
 * @param {Function} options.skip - Hàm quyết định có skip rate limit không
 * @returns {Function} Express middleware
 */
export function rateLimiter({
  windowMs = 60 * 1000, // 1 phút
  max = 60, // 60 request/phút
  message = 'Quá nhiều yêu cầu, vui lòng thử lại sau',
  statusCode = 429,
  keyGenerator = (req) => req.ip,
  skip = () => false,
} = {}) {
  // Dọn dẹp store định kỳ (mỗi 5 phút)
  if (!rateLimiter.cleanupInterval) {
    rateLimiter.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, { resetTime }] of store.entries()) {
        if (now > resetTime) store.delete(key);
      }
    }, 5 * 60 * 1000);
    // Không block process exit
    rateLimiter.cleanupInterval.unref?.();
  }

  return (req, res, next) => {
    if (skip(req, res)) return next();

    const key = keyGenerator(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    let record = store.get(key);

    if (!record || record.resetTime < now) {
      // Window mới
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      store.set(key, record);
    } else {
      // Cùng window
      record.count++;
      if (record.count > max) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(statusCode).json({
          success: false,
          message,
          retryAfter,
        });
      }
    }

    // Headers thông tin rate limit
    res.set({
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(Math.max(0, max - record.count)),
      'X-RateLimit-Reset': String(Math.ceil(record.resetTime / 1000)),
    });

    next();
  };
}

// Pre-configured limiters cho các endpoint phổ biến
export const publicApiLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 phút
  max: 60, // 60 req/phút
  message: 'Quá nhiều yêu cầu đến API công khai, vui lòng thử lại sau',
});

export const strictPublicApiLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 20, // 20 req/phút cho endpoint nhạy cảm hơn
  message: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
});

export const authApiLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 10, // 10 lần thử login/15 phút
  message: 'Quá nhiều lần thử đăng nhập, vui lòng thử lại sau 15 phút',
  keyGenerator: (req) => req.ip,
});