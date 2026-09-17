import express from 'express';
const router = express.Router();

import { getBalance,deposit, withdraw, transfer, getTransactionHistory, getTransactionDetail, resetTestnetWallet } from '../controllers/walletController.js';
import auth from '../middleware/walletMiddleware.js';


// Tất cả route đều yêu cầu đăng nhập
router.use(auth);

// Số dư
router.get('/balance', getBalance);

// Nạp / rút (testnet - mô phỏng, không phải giao dịch thật)
router.post('/deposit', deposit);
router.post('/withdraw', withdraw);

// Chuyển tiền giữa SPOT và FUNDING
router.post('/transfer', transfer);

// Lịch sử giao dịch
router.get('/transactions', getTransactionHistory);
router.get('/transactions/:id', getTransactionDetail);

// Tiện ích riêng cho môi trường test
router.post('/reset', resetTestnetWallet);

export default router;