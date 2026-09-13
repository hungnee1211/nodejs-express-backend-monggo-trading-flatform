import express from 'express';
const router = express.Router();

import * as walletController from '../controllers/walletController.js';
import auth from '../middleware/walletMiddleware.js';


// Tất cả route đều yêu cầu đăng nhập
router.use(auth);

// Số dư
router.get('/balance', walletController.getBalance);

// Nạp / rút (testnet - mô phỏng, không phải giao dịch thật)
router.post('/deposit', walletController.deposit);
router.post('/withdraw', walletController.withdraw);

// Chuyển tiền giữa SPOT và FUNDING
router.post('/transfer', walletController.transfer);

// Lịch sử giao dịch
router.get('/transactions', walletController.getTransactionHistory);
router.get('/transactions/:id', walletController.getTransactionDetail);

// Tiện ích riêng cho môi trường test
router.post('/reset', walletController.resetTestnetWallet);

export default router;