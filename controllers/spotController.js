import * as spotService from '../services/spot.service.js';
import { success, error } from '../utils/response.js';

/**
 * [GET] /api/spot/symbols
 * Lấy danh sách symbol hỗ trợ giao dịch spot
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const getSymbols = async (req, res) => {
  return success(res, spotService.listSymbols(), 'Danh sách symbol');
};

/**
 * [GET] /api/spot/balance?asset=BTC
 * Số dư ví SPOT (chỉ lọc walletType SPOT)
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const getBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const { asset } = req.query;

    // Validate asset nếu có truyền
    if (asset !== undefined) {
      if (typeof asset !== 'string' || asset.trim() === '') {
        return error(res, 'Asset không hợp lệ', 422);
      }
    }

    const data = await spotService.getBalance(userId, asset);
    return success(res, data, 'Lấy số dư spot thành công');
  } catch (err) {
    return error(res, err.message || 'Không thể lấy số dư spot', err.statusCode || 500);
  }
};

/**
 * [GET] /api/spot/orderbook?symbol=BTCUSDT&depth=20
 * Lấy sổ lệnh (order book) cho một symbol
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const getOrderBook = async (req, res) => {
  try {
    const { symbol, depth } = req.query;

    // Validate symbol (bắt buộc)
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') {
      return error(res, 'Symbol là bắt buộc', 422);
    }

    // Validate depth (optional, mặc định 20)
    let depthNum = 20;
    if (depth !== undefined) {
      const parsed = parseInt(depth, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        return error(res, 'Depth phải là số nguyên từ 1 đến 100', 422);
      }
      depthNum = parsed;
    }

    const data = await spotService.getOrderBook(symbol, depthNum);
    return success(res, data, 'Lấy sổ lệnh thành công');
  } catch (err) {
    return error(res, err.message || 'Không thể lấy sổ lệnh', err.statusCode || 500);
  }
};

/**
 * [POST] /api/spot/order
 * Đặt lệnh spot mới
 * body: { symbol, side, type, price, quantity, quoteOrderQty, idempotencyKey }
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const placeOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      symbol,
      side,
      type,
      price,
      quantity,
      quoteOrderQty,
      idempotencyKey,
    } = req.body;

    // Validate required fields
    const requiredFields = ['symbol', 'side', 'type', 'idempotencyKey'];
    const missing = requiredFields.filter((field) => {
      const val = req.body[field];
      return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
    });

    if (missing.length > 0) {
      return error(res, `Thiếu trường bắt buộc: ${missing.join(', ')}`, 422);
    }

    // Validate enum values
    if (!['BUY', 'SELL'].includes(side)) {
      return error(res, 'side phải là BUY hoặc SELL', 422);
    }
    if (!['LIMIT', 'MARKET'].includes(type)) {
      return error(res, 'type phải là LIMIT hoặc MARKET', 422);
    }

    // Validate numeric fields
    if (price !== undefined && price !== null && price !== '') {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum <= 0) {
        return error(res, 'price phải là số dương', 422);
      }
    }

    if (quantity !== undefined && quantity !== null && quantity !== '') {
      const qtyNum = parseFloat(quantity);
      if (isNaN(qtyNum) || qtyNum <= 0) {
        return error(res, 'quantity phải là số dương', 422);
      }
    }

    if (quoteOrderQty !== undefined && quoteOrderQty !== null && quoteOrderQty !== '') {
      const quoteNum = parseFloat(quoteOrderQty);
      if (isNaN(quoteNum) || quoteNum <= 0) {
        return error(res, 'quoteOrderQty phải là số dương', 422);
      }
    }

    const { order, isDuplicate } = await spotService.placeOrder(userId, req.body);

    if (isDuplicate) {
      return success(res, order, 'Lệnh đã được xử lý trước đó (idempotent)');
    }
    return success(res, order, 'Đặt lệnh thành công', 201);
  } catch (err) {
    return error(res, err.message || 'Đặt lệnh thất bại', err.statusCode || 500);
  }
};

/**
 * [DELETE] /api/spot/order/:id
 * Huỷ lệnh spot
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const cancelOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Validate ObjectId
    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return error(res, 'ID lệnh không hợp lệ', 400);
    }

    const order = await spotService.cancelOrder(userId, id);
    return success(res, order, 'Huỷ lệnh thành công');
  } catch (err) {
    // Service throws 404 for not found, 400 for invalid status
    return error(res, err.message || 'Huỷ lệnh thất bại', err.statusCode || 500);
  }
};

/**
 * [GET] /api/spot/orders/open?symbol=BTCUSDT
 * Lấy danh sách lệnh đang mở
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const getOpenOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { symbol } = req.query;

    // Validate symbol nếu có
    if (symbol !== undefined && (typeof symbol !== 'string' || symbol.trim() === '')) {
      return error(res, 'Symbol không hợp lệ', 422);
    }

    const orders = await spotService.getOpenOrders(userId, req.query);
    return success(res, orders, 'Danh sách lệnh đang mở');
  } catch (err) {
    return error(res, err.message || 'Không thể lấy danh sách lệnh mở', err.statusCode || 500);
  }
};

/**
 * [GET] /api/spot/orders/history?symbol=BTCUSDT&status=FILLED&page=1&limit=20
 * Lấy lịch sử lệnh
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const getOrderHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { symbol, status, page, limit } = req.query;

    // Validate symbol
    if (symbol !== undefined && (typeof symbol !== 'string' || symbol.trim() === '')) {
      return error(res, 'Symbol không hợp lệ', 422);
    }

    // Validate status enum
    const validStatuses = ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'];
    if (status !== undefined) {
      const statusUpper = String(status).toUpperCase();
      if (!validStatuses.includes(statusUpper)) {
        return error(res, `Status không hợp lệ. Giá trị cho phép: ${validStatuses.join(', ')}`, 422);
      }
    }

    // Validate pagination
    const pageNum = parsePositiveInt(page, { min: 1, defaultVal: 1 });
    const limitNum = parsePositiveInt(limit, { min: 1, max: 100, defaultVal: 20 });

    if (pageNum === null) {
      return error(res, 'page phải là số nguyên dương', 422);
    }
    if (limitNum === null) {
      return error(res, 'limit phải là số nguyên từ 1 đến 100', 422);
    }

    const data = await spotService.getOrderHistory(userId, {
      symbol,
      status,
      page: pageNum,
      limit: limitNum,
    });

    return success(res, data);
  } catch (err) {
    return error(res, err.message || 'Không thể lấy lịch sử lệnh', err.statusCode || 500);
  }
};

/**
 * [GET] /api/spot/order/:id
 * Lấy chi tiết một lệnh
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const getOrderDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Validate ObjectId
    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return error(res, 'ID lệnh không hợp lệ', 400);
    }

    const order = await spotService.getOrderDetail(userId, id);
    return success(res, order);
  } catch (err) {
    // Service throws 404 for not found
    return error(res, err.message || 'Không thể lấy chi tiết lệnh', err.statusCode || 500);
  }
};

/**
 * [GET] /api/spot/trades?symbol=BTCUSDT&page=1&limit=20
 * Lấy lịch sử khớp lệnh (trades) của user
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export const getMyTrades = async (req, res) => {
  try {
    const userId = req.user.id;
    const { symbol, page, limit } = req.query;

    // Validate symbol
    if (symbol !== undefined && (typeof symbol !== 'string' || symbol.trim() === '')) {
      return error(res, 'Symbol không hợp lệ', 422);
    }

    // Validate pagination
    const pageNum = parsePositiveInt(page, { min: 1, defaultVal: 1 });
    const limitNum = parsePositiveInt(limit, { min: 1, max: 100, defaultVal: 20 });

    if (pageNum === null) {
      return error(res, 'page phải là số nguyên dương', 422);
    }
    if (limitNum === null) {
      return error(res, 'limit phải là số nguyên từ 1 đến 100', 422);
    }

    const data = await spotService.getMyTrades(userId, {
      symbol,
      page: pageNum,
      limit: limitNum,
    });

    return success(res, data);
  } catch (err) {
    return error(res, err.message || 'Không thể lấy lịch sử khớp lệnh', err.statusCode || 500);
  }
};

/**
 * Helper function để parse positive integer
 * @param {any} val
 * @param {Object} options
 * @returns {number|null}
 */
function parsePositiveInt(val, { min = 1, max = Number.MAX_SAFE_INTEGER, defaultVal = null } = {}) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const num = parseInt(val, 10);
  if (!Number.isInteger(num) || num < min || num > max) return null;
  return num;
}