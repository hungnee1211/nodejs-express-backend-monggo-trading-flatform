import express from 'express';
import auth from '../middleware/walletMiddleware.js';
import { publicApiLimiter, strictPublicApiLimiter } from '../middleware/rateLimiter.js';
import {
  getSymbols,
  getOrderBook,
  getBalance,
  placeOrder,
  cancelOrder,
  getOpenOrders,
  getOrderHistory,
  getOrderDetail,
  getMyTrades,
} from '../controllers/spotController.js';

const router = express.Router();

// Route public: không cần đăng nhập
// Áp dụng rate limiter cho các endpoint public
router.get('/symbols', publicApiLimiter, getSymbols);
router.get('/orderbook', publicApiLimiter, getOrderBook);

// Route cần đăng nhập
router.use(auth);

router.get('/balance', getBalance);
router.post('/order', strictPublicApiLimiter, placeOrder);
router.delete('/order/:id', cancelOrder);
router.get('/order/:id', getOrderDetail);
router.get('/orders/open', getOpenOrders);
router.get('/orders/history', getOrderHistory);
router.get('/trades', getMyTrades);

export default router;