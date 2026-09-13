import mongoose from 'mongoose';
import Wallet from '../models/wallet.js';
import Transaction from '../models/transaction.js';
import { success, error } from '../utils/response.js';

// Danh sách asset được phép trên testnet (tuỳ chỉnh theo dự án)
const ALLOWED_ASSETS = ['USDT', 'BTC', 'ETH', 'BNB'];

// Giới hạn nạp/rút mỗi lần trên testnet để tránh dữ liệu vô lý
const LIMITS = {
  MIN_AMOUNT: 0.00000001,
  MAX_DEPOSIT: 1_000_000,
  MAX_WITHDRAW: 1_000_000,
};

/**
 * Helper: tìm hoặc tạo ví cho user + asset + walletType (mặc định SPOT)
 */
async function findOrCreateWallet(userId, asset, session, walletType = 'SPOT') {
  let wallet = await Wallet.findOne({ userId, asset, walletType }).session(session);
  if (!wallet) {
    wallet = await Wallet.create([{ userId, asset, walletType, available: 0, locked: 0 }], { session });
    wallet = wallet[0];
  }
  return wallet;
}

/**
 * [GET] /api/wallet/balance
 * Lấy số dư tất cả các ví (hoặc theo 1 asset cụ thể qua query ?asset=USDT)
 */
export const getBalance = async (req, res) => {
  try {
    const userId = req.user.id; // lấy từ middleware xác thực (auth)
    const { asset } = req.query;

    const filter = { userId };
    if (asset) filter.asset = asset.toUpperCase();

    const wallets = await Wallet.find(filter).lean();

    const result = wallets.map((w) => ({
      asset: w.asset,
      available: w.available,
      locked: w.locked,
      total: w.available + w.locked,
      isTestnet: w.isTestnet,
      walletType: w.walletType || 'SPOT',
    }));

    return success(res, result, 'Lấy số dư thành công');
  } catch (err) {
    return error(res, 'Không thể lấy số dư', 500, err.message);
  }
};

/**
 * [POST] /api/wallet/deposit
 * body: { asset, amount, idempotencyKey, note }
 * Mô phỏng nạp tiền trên testnet — KHÔNG kết nối cổng thanh toán thật.
 */
export const deposit = async (req, res) => {
  const { asset, amount, idempotencyKey, note } = req.body;
  const userId = req.user.id;

  // ---- Validate input ----
  if (!asset || !ALLOWED_ASSETS.includes(asset.toUpperCase())) {
    return error(res, `Asset không hợp lệ. Chỉ hỗ trợ: ${ALLOWED_ASSETS.join(', ')}`, 422);
  }
  const amountNum = Number(amount);
  if (!amountNum || isNaN(amountNum) || amountNum < LIMITS.MIN_AMOUNT) {
    return error(res, 'Số tiền nạp không hợp lệ', 422);
  }
  if (amountNum > LIMITS.MAX_DEPOSIT) {
    return error(res, `Vượt quá hạn mức nạp tối đa (${LIMITS.MAX_DEPOSIT})`, 422);
  }
  if (!idempotencyKey) {
    return error(res, 'Thiếu idempotencyKey để chống gửi trùng request', 422);
  }

  // ---- Chống double-submit ----
  const existed = await Transaction.findOne({ idempotencyKey });
  if (existed) {
    return success(res, existed, 'Giao dịch đã được xử lý trước đó (idempotent)');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const assetUpper = asset.toUpperCase();
    const wallet = await findOrCreateWallet(userId, assetUpper, session);

    // Cộng số dư khả dụng (mô phỏng nạp thành công ngay trên testnet)
    wallet.available += amountNum;
    await wallet.save({ session });

    const [tx] = await Transaction.create(
      [
        {
          userId,
          walletId: wallet._id,
          asset: assetUpper,
          type: 'DEPOSIT',
          amount: amountNum,
          status: 'SUCCESS',
          network: 'TESTNET',
          idempotencyKey,
          note,
          balanceAfter: wallet.available,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return success(res, tx, 'Nạp tiền testnet thành công', 201);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    // Lỗi trùng idempotencyKey do race condition (unique index)
    if (err.code === 11000) {
      const existing = await Transaction.findOne({ idempotencyKey });
      return success(res, existing, 'Giao dịch đã được xử lý trước đó (idempotent)');
    }
    return error(res, 'Nạp tiền thất bại', 500, err.message);
  }
};

/**
 * [POST] /api/wallet/withdraw
 * body: { asset, amount, idempotencyKey, address, note }
 * Mô phỏng rút tiền trên testnet — trừ số dư khả dụng ngay, không gửi ra ngoài thật.
 */
export const withdraw = async (req, res) => {
  const { asset, amount, idempotencyKey, address, note } = req.body;
  const userId = req.user.id;

  // ---- Validate input ----
  if (!asset || !ALLOWED_ASSETS.includes(asset.toUpperCase())) {
    return error(res, `Asset không hợp lệ. Chỉ hỗ trợ: ${ALLOWED_ASSETS.join(', ')}`, 422);
  }
  const amountNum = Number(amount);
  if (!amountNum || isNaN(amountNum) || amountNum < LIMITS.MIN_AMOUNT) {
    return error(res, 'Số tiền rút không hợp lệ', 422);
  }
  if (amountNum > LIMITS.MAX_WITHDRAW) {
    return error(res, `Vượt quá hạn mức rút tối đa (${LIMITS.MAX_WITHDRAW})`, 422);
  }
  if (!idempotencyKey) {
    return error(res, 'Thiếu idempotencyKey để chống gửi trùng request', 422);
  }

  const existed = await Transaction.findOne({ idempotencyKey });
  if (existed) {
    return success(res, existed, 'Giao dịch đã được xử lý trước đó (idempotent)');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const assetUpper = asset.toUpperCase();
    // Rút từ ví SPOT (mặc định)
    const wallet = await Wallet.findOne({ userId, asset: assetUpper, walletType: 'SPOT' }).session(session);

    if (!wallet || wallet.available < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return error(res, 'Số dư khả dụng không đủ để rút', 400);
    }

    wallet.available -= amountNum;
    await wallet.save({ session });

    const [tx] = await Transaction.create(
      [
        {
          userId,
          walletId: wallet._id,
          asset: assetUpper,
          type: 'WITHDRAW',
          amount: amountNum,
          status: 'SUCCESS',
          network: 'TESTNET',
          address: address || 'testnet-simulated-address',
          idempotencyKey,
          note,
          balanceAfter: wallet.available,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return success(res, tx, 'Rút tiền testnet thành công', 201);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    if (err.code === 11000) {
      const existing = await Transaction.findOne({ idempotencyKey });
      return success(res, existing, 'Giao dịch đã được xử lý trước đó (idempotent)');
    }
    return error(res, 'Rút tiền thất bại', 500, err.message);
  }
};

/**
 * [GET] /api/wallet/transactions
 * Query: ?type=DEPOSIT|WITHDRAW&asset=USDT&page=1&limit=20
 */
export const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, asset, page = 1, limit = 20 } = req.query;

    const filter = { userId };
    if (type) filter.type = type.toUpperCase();
    if (asset) filter.asset = asset.toUpperCase();

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const [items, totalItems] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    return success(res, {
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems,
        totalPages: Math.ceil(totalItems / limitNum),
      },
    });
  } catch (err) {
    return error(res, 'Không thể lấy lịch sử giao dịch', 500, err.message);
  }
};

/**
 * [GET] /api/wallet/transactions/:id
 * Xem chi tiết 1 giao dịch
 */
export const getTransactionDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const tx = await Transaction.findOne({ _id: id, userId }).lean();
    if (!tx) return error(res, 'Không tìm thấy giao dịch', 404);

    return success(res, tx);
  } catch (err) {
    return error(res, 'Không thể lấy chi tiết giao dịch', 500, err.message);
  }
};

/**
 * [POST] /api/wallet/reset (chỉ dùng cho testnet — reset toàn bộ ví về 0)
 * Hữu ích khi cần reset môi trường test cho QA/dev.
 */
export const resetTestnetWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    await Wallet.updateMany({ userId }, { $set: { available: 0, locked: 0 } });
    // Không xoá lịch sử transaction để giữ audit trail; có thể xoá nếu cần:
    // await Transaction.deleteMany({ userId });

    return success(res, null, 'Đã reset số dư testnet về 0');
  } catch (err) {
    return error(res, 'Không thể reset ví', 500, err.message);
  }
};

/**
 * [POST] /api/wallet/transfer
 * body: { asset, amount, fromWalletType, toWalletType, idempotencyKey, note }
 * Chuyển tiền giữa Spot và Funding wallet cho cùng 1 asset
 * fromWalletType: 'SPOT' | 'FUNDING'
 * toWalletType: 'SPOT' | 'FUNDING'
 */
export const transfer = async (req, res) => {
  const { asset, amount, fromWalletType, toWalletType, idempotencyKey, note } = req.body;
  const userId = req.user.id;

  // ---- Validate input ----
  if (!asset || !ALLOWED_ASSETS.includes(asset.toUpperCase())) {
    return error(res, `Asset không hợp lệ. Chỉ hỗ trợ: ${ALLOWED_ASSETS.join(', ')}`, 422);
  }
  const amountNum = Number(amount);
  if (!amountNum || isNaN(amountNum) || amountNum < LIMITS.MIN_AMOUNT) {
    return error(res, 'Số tiền chuyển không hợp lệ', 422);
  }
  if (amountNum > LIMITS.MAX_WITHDRAW) {
    return error(res, `Vượt quá hạn mức chuyển tối đa (${LIMITS.MAX_WITHDRAW})`, 422);
  }
  if (!idempotencyKey) {
    return error(res, 'Thiếu idempotencyKey để chống gửi trùng request', 422);
  }
  if (!fromWalletType || !toWalletType || fromWalletType === toWalletType) {
    return error(res, 'fromWalletType và toWalletType phải khác nhau (SPOT/FUNDING)', 422);
  }
  if (!['SPOT', 'FUNDING'].includes(fromWalletType) || !['SPOT', 'FUNDING'].includes(toWalletType)) {
    return error(res, 'Wallet type phải là SPOT hoặc FUNDING', 422);
  }

  // ---- Chống double-submit ----
  const existed = await Transaction.findOne({ idempotencyKey });
  if (existed) {
    return success(res, existed, 'Giao dịch đã được xử lý trước đó (idempotent)');
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const assetUpper = asset.toUpperCase();

    // Lấy ví nguồn (để trừ tiền)
    const fromWallet = await Wallet.findOne({ userId, asset: assetUpper, walletType: fromWalletType }).session(session);
    if (!fromWallet || fromWallet.available < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return error(res, `Số dư ${fromWalletType} không đủ để chuyển`, 400);
    }

    // Lấy ví đích (để cộng tiền)
    const toWallet = await findOrCreateWalletWithType(userId, assetUpper, toWalletType, session);

    // Trừ từ ví nguồn
    fromWallet.available -= amountNum;
    await fromWallet.save({ session });

    // Cộng vào ví đích
    toWallet.available += amountNum;
    await toWallet.save({ session });

    // Tạo 2 transaction record: 1 cho chuyển ra, 1 cho chuyển vào
    const [txOut, txIn] = await Transaction.create(
      [
        {
          userId,
          walletId: fromWallet._id,
          asset: assetUpper,
          type: 'TRANSFER_OUT',
          amount: amountNum,
          status: 'SUCCESS',
          network: 'TESTNET',
          idempotencyKey: `${idempotencyKey}_out`,
          note: `${note || ''} [Chuyển từ ${fromWalletType} đến ${toWalletType}]`.trim(),
          balanceAfter: fromWallet.available,
        },
        {
          userId,
          walletId: toWallet._id,
          asset: assetUpper,
          type: 'TRANSFER_IN',
          amount: amountNum,
          status: 'SUCCESS',
          network: 'TESTNET',
          idempotencyKey: `${idempotencyKey}_in`,
          note: `${note || ''} [Chuyển từ ${fromWalletType} đến ${toWalletType}]`.trim(),
          balanceAfter: toWallet.available,
        },
      ],
      { session, ordered: true }
    );

    await session.commitTransaction();
    session.endSession();

    // Lấy lại số dư mới nhất để trả về frontend
    const updatedWallets = await Wallet.find({ userId, asset: assetUpper }).lean();
    const balances = updatedWallets.map((w) => ({
      asset: w.asset,
      available: w.available,
      locked: w.locked,
      total: w.available + w.locked,
      isTestnet: w.isTestnet,
      walletType: w.walletType || 'SPOT',
    }));

    return success(res, { 
      transferOut: txOut, 
      transferIn: txIn,
      balances 
    }, 'Chuyển tiền thành công', 201);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    if (err.code === 11000) {
      const existing = await Transaction.findOne({ idempotencyKey });
      return success(res, existing, 'Giao dịch đã được xử lý trước đó (idempotent)');
    }
    return error(res, 'Chuyển tiền thất bại', 500, err.message);
  }
};

/**
 * Helper: tìm hoặc tạo ví cho user + asset + walletType (SPOT/FUNDING)
 */
async function findOrCreateWalletWithType(userId, asset, walletType, session) {
  let wallet = await Wallet.findOne({ userId, asset, walletType }).session(session);
  if (!wallet) {
    wallet = await Wallet.create([{ userId, asset, walletType, available: 0, locked: 0 }], { session });
    wallet = wallet[0];
  }
  return wallet;
}