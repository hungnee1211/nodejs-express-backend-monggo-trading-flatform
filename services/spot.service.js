import mongoose from 'mongoose';
import Order from '../models/order.js';
import Trade from '../models/trade.js';
import Wallet from '../models/wallet.js';
import { SYMBOLS, getSymbolConfig, round } from '../config/spot.config.js';

// Service ném lỗi kèm statusCode, controller chỉ việc bắt và trả về client.
class SpotError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ================== Helper thao tác ví (dùng chung trong session) ==================

async function getWallet(userId, asset, session) {
  let wallet = await Wallet.findOne({ userId, asset, walletType: 'SPOT' }).session(session);
  if (!wallet) {
    const created = await Wallet.create(
      [{ userId, asset, walletType: 'SPOT', available: 0, locked: 0 }],
      { session }
    );
    wallet = created[0];
  }
  return wallet;
}

async function lockFunds(userId, asset, amount, session) {
  const wallet = await getWallet(userId, asset, session);
  if (wallet.available < amount) {
    throw new SpotError(`Số dư ${asset} không đủ`, 400);
  }
  wallet.available -= amount;
  wallet.locked += amount;
  await wallet.save({ session });
}

async function unlockFunds(userId, asset, amount, session) {
  if (amount <= 0) return;
  const wallet = await getWallet(userId, asset, session);
  const amt = Math.min(amount, wallet.locked);
  wallet.locked -= amt;
  wallet.available += amt;
  await wallet.save({ session });
}

async function consumeLocked(userId, asset, amount, session) {
  const wallet = await getWallet(userId, asset, session);
  wallet.locked = Math.max(0, wallet.locked - amount);
  await wallet.save({ session });
}

async function creditAvailable(userId, asset, amount, session) {
  const wallet = await getWallet(userId, asset, session);
  wallet.available += amount;
  await wallet.save({ session });
}

// ================== Matching engine (nội bộ, không export) ==================

/**
 * Khớp lệnh price-time priority. Chạy trong transaction của placeOrder.
 * takerOrder: order vừa tạo, tiền cần thiết đã được khoá trước đó.
 */
async function matchOrder(takerOrder, opts, session) {
  const { symbol, side, type, price, baseAsset, quoteAsset } = takerOrder;
  const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';

  const priceFilter = type === 'LIMIT'
    ? (side === 'BUY' ? { price: { $lte: price } } : { price: { $gte: price } })
    : {};

  const sortOrder = side === 'BUY' ? { price: 1, createdAt: 1 } : { price: -1, createdAt: 1 };

  const makerOrders = await Order.find({
    symbol, side: oppositeSide, type: 'LIMIT',
    status: { $in: ['NEW', 'PARTIALLY_FILLED'] },
    ...priceFilter,
  }).sort(sortOrder).session(session);

  const isMarketBuyByQuote = side === 'BUY' && type === 'MARKET' && !!opts.quoteOrderQtyNum;

  let remainingQty = isMarketBuyByQuote ? null : takerOrder.quantity;
  let remainingQuote = isMarketBuyByQuote ? opts.quoteOrderQtyNum : null;
  let filledQty = 0;
  let filledQuoteTotal = 0;

  for (const maker of makerOrders) {
    if (remainingQty !== null && remainingQty <= 1e-12) break;
    if (remainingQuote !== null && remainingQuote <= 1e-12) break;

    const makerRemaining = maker.quantity - maker.filledQuantity;
    if (makerRemaining <= 0) continue;

    const tradeQty = remainingQuote !== null
      ? Math.min(makerRemaining, remainingQuote / maker.price)
      : Math.min(makerRemaining, remainingQty);
    if (tradeQty <= 0) continue;

    const tradePrice = maker.price;
    const tradeQuote = tradeQty * tradePrice;

    const buyOrder = side === 'BUY' ? takerOrder : maker;
    const sellOrder = side === 'BUY' ? maker : takerOrder;

    await consumeLocked(sellOrder.userId, baseAsset, tradeQty, session);
    await creditAvailable(sellOrder.userId, quoteAsset, tradeQuote, session);

    await consumeLocked(buyOrder.userId, quoteAsset, tradeQuote, session);
    await creditAvailable(buyOrder.userId, baseAsset, tradeQty, session);

    maker.filledQuantity += tradeQty;
    maker.avgFillPrice = ((maker.avgFillPrice * (maker.filledQuantity - tradeQty)) + tradeQty * tradePrice) / maker.filledQuantity;
    maker.status = maker.filledQuantity >= maker.quantity ? 'FILLED' : 'PARTIALLY_FILLED';
    await maker.save({ session });

    filledQty += tradeQty;
    filledQuoteTotal += tradeQuote;
    if (remainingQty !== null) remainingQty -= tradeQty;
    if (remainingQuote !== null) remainingQuote -= tradeQuote;

    await Trade.create([{
      symbol, price: tradePrice, quantity: tradeQty, quoteAmount: tradeQuote,
      buyOrderId: buyOrder._id, sellOrderId: sellOrder._id,
      buyUserId: buyOrder.userId, sellUserId: sellOrder.userId,
    }], { session });
  }

  if (filledQty > 0) {
    takerOrder.filledQuantity = filledQty;
    takerOrder.avgFillPrice = filledQuoteTotal / filledQty;
    if (isMarketBuyByQuote) takerOrder.quantity = filledQty;
  }

  if (type === 'MARKET') {
    takerOrder.status = filledQty > 0
      ? (filledQty < takerOrder.quantity ? 'PARTIALLY_FILLED' : 'FILLED')
      : 'CANCELED';

    if (side === 'BUY') {
      const lockedButUnused = remainingQuote !== null ? Math.max(remainingQuote, 0) : 0;
      if (lockedButUnused > 0) await unlockFunds(takerOrder.userId, quoteAsset, lockedButUnused, session);
    } else {
      const unfilledQty = takerOrder.quantity - filledQty;
      if (unfilledQty > 0) await unlockFunds(takerOrder.userId, baseAsset, unfilledQty, session);
    }
  } else {
    const fullyFilled = takerOrder.filledQuantity >= takerOrder.quantity;
    takerOrder.status = fullyFilled ? 'FILLED' : (filledQty > 0 ? 'PARTIALLY_FILLED' : 'NEW');
  }

  await takerOrder.save({ session });
}

// ================== Service functions (export) ==================

export function listSymbols() {
  return Object.entries(SYMBOLS).map(([symbol, cfg]) => ({ symbol, ...cfg }));
}

/**
 * Lấy số dư ví SPOT của user.
 * - Không truyền asset: trả về tất cả asset đang được hỗ trợ giao dịch spot (base + quote của mọi symbol),
 *   asset nào chưa từng có ví (chưa nạp/giao dịch) vẫn được trả về với available/locked = 0.
 * - Truyền asset: chỉ trả về đúng 1 asset đó (nếu asset không thuộc danh sách hỗ trợ -> lỗi 422).
 */
export async function getBalance(userId, assetRaw) {
  const supportedAssets = new Set();
  Object.values(SYMBOLS).forEach(({ baseAsset, quoteAsset }) => {
    supportedAssets.add(baseAsset);
    supportedAssets.add(quoteAsset);
  });

  const filter = { userId, walletType: 'SPOT' };
  let assetsToReturn = [...supportedAssets];

  if (assetRaw) {
    const assetUpper = assetRaw.toUpperCase();
    if (!supportedAssets.has(assetUpper)) throw new SpotError('Asset không hợp lệ', 422);
    filter.asset = assetUpper;
    assetsToReturn = [assetUpper];
  }

  const wallets = await Wallet.find(filter).lean();
  const walletMap = new Map(wallets.map((w) => [w.asset, w]));

  return assetsToReturn
    .map((asset) => {
      const w = walletMap.get(asset);
      const available = w?.available || 0;
      const locked = w?.locked || 0;
      return { asset, available, locked, total: available + locked };
    })
    .sort((a, b) => a.asset.localeCompare(b.asset));
}

export async function getOrderBook(symbolRaw, depthRaw = 20) {
  const symbol = symbolRaw?.toUpperCase();
  if (!symbol || !getSymbolConfig(symbol)) throw new SpotError('Symbol không hợp lệ', 422);
  const depth = Number(depthRaw) || 20;

  const openOrders = await Order.find({
    symbol, type: 'LIMIT', status: { $in: ['NEW', 'PARTIALLY_FILLED'] },
  }).lean();

  const bidsMap = new Map();
  const asksMap = new Map();
  for (const o of openOrders) {
    const remaining = o.quantity - o.filledQuantity;
    if (remaining <= 0) continue;
    const map = o.side === 'BUY' ? bidsMap : asksMap;
    map.set(o.price, (map.get(o.price) || 0) + remaining);
  }

  const bids = [...bidsMap.entries()].sort((a, b) => b[0] - a[0]).slice(0, depth);
  const asks = [...asksMap.entries()].sort((a, b) => a[0] - b[0]).slice(0, depth);

  return { symbol, bids, asks };
}

/**
 * Đặt lệnh spot: validate -> khoá tiền -> tạo order -> khớp lệnh, tất cả trong 1 transaction.
 * payload: { symbol, side, type, price, quantity, quoteOrderQty, idempotencyKey }
 */
export async function placeOrder(userId, payload) {
  const { symbol, side, type, price, quantity, quoteOrderQty, idempotencyKey } = payload;

  const sym = symbol?.toUpperCase();
  const symbolCfg = getSymbolConfig(sym);
  if (!symbolCfg) throw new SpotError('Symbol không hợp lệ', 422);
  if (!['BUY', 'SELL'].includes(side)) throw new SpotError('side phải là BUY hoặc SELL', 422);
  if (!['LIMIT', 'MARKET'].includes(type)) throw new SpotError('type phải là LIMIT hoặc MARKET', 422);
  if (!idempotencyKey) throw new SpotError('Thiếu idempotencyKey', 422);

  const existed = await Order.findOne({ idempotencyKey });
  if (existed) return { order: existed, isDuplicate: true };

  const { baseAsset, quoteAsset, pricePrecision, qtyPrecision, minQty, minNotional } = symbolCfg;

  const priceNum = price ? round(Number(price), pricePrecision) : null;
  const qtyNum = quantity ? round(Number(quantity), qtyPrecision) : null;
  const quoteOrderQtyNum = quoteOrderQty ? round(Number(quoteOrderQty), pricePrecision) : null;

  if (type === 'LIMIT') {
    if (!priceNum || priceNum <= 0) throw new SpotError('price không hợp lệ với lệnh LIMIT', 422);
    if (!qtyNum || qtyNum < minQty) throw new SpotError(`quantity tối thiểu là ${minQty}`, 422);
    if (priceNum * qtyNum < minNotional) throw new SpotError(`Giá trị lệnh tối thiểu là ${minNotional} ${quoteAsset}`, 422);
  } else if (side === 'BUY') {
    if (!qtyNum && !quoteOrderQtyNum) throw new SpotError('Cần quantity hoặc quoteOrderQty cho lệnh MARKET BUY', 422);
  } else {
    if (!qtyNum || qtyNum < minQty) throw new SpotError(`quantity tối thiểu là ${minQty}`, 422);
  }

  const session = await mongoose.startSession();
  try {
    let orderId;

    await session.withTransaction(async () => {
      if (side === 'BUY') {
        if (type === 'LIMIT') {
          await lockFunds(userId, quoteAsset, round(priceNum * qtyNum, pricePrecision), session);
        } else if (quoteOrderQtyNum) {
          await lockFunds(userId, quoteAsset, quoteOrderQtyNum, session);
        } else {
          const asks = await Order.find({
            symbol: sym, side: 'SELL', type: 'LIMIT', status: { $in: ['NEW', 'PARTIALLY_FILLED'] },
          }).sort({ price: 1, createdAt: 1 }).session(session);

          let need = qtyNum, estCost = 0;
          for (const a of asks) {
            const remain = a.quantity - a.filledQuantity;
            const take = Math.min(remain, need);
            estCost += take * a.price;
            need -= take;
            if (need <= 0) break;
          }
          if (need > 1e-9) throw new SpotError('Không đủ thanh khoản để khớp lệnh MARKET', 400);
          await lockFunds(userId, quoteAsset, round(estCost * 1.001, pricePrecision), session);
        }
      } else {
        await lockFunds(userId, baseAsset, qtyNum, session);
      }

      const [created] = await Order.create(
        [{
          userId, symbol: sym, baseAsset, quoteAsset, side, type,
          price: priceNum, quantity: qtyNum || 0,
          filledQuantity: 0, avgFillPrice: 0, status: 'NEW', idempotencyKey,
        }],
        { session }
      );

      await matchOrder(created, { quoteOrderQtyNum }, session);
      orderId = created._id;
    });

    const order = await Order.findById(orderId);
    return { order, isDuplicate: false };
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Order.findOne({ idempotencyKey });
      return { order: existing, isDuplicate: true };
    }
    throw err instanceof SpotError ? err : new SpotError(err.message || 'Đặt lệnh thất bại', 500);
  } finally {
    session.endSession();
  }
}

export async function cancelOrder(userId, orderId) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, userId }).session(session);
      if (!order) throw new SpotError('Không tìm thấy lệnh', 404);
      if (!['NEW', 'PARTIALLY_FILLED'].includes(order.status)) {
        throw new SpotError('Lệnh không ở trạng thái có thể huỷ', 400);
      }

      const remainingQty = order.quantity - order.filledQuantity;
      if (order.side === 'BUY') {
        await unlockFunds(userId, order.quoteAsset, round(remainingQty * order.price, 8), session);
      } else {
        await unlockFunds(userId, order.baseAsset, remainingQty, session);
      }

      order.status = 'CANCELED';
      await order.save({ session });
      result = order;
    });
    return result;
  } catch (err) {
    throw err instanceof SpotError ? err : new SpotError(err.message || 'Huỷ lệnh thất bại', 500);
  } finally {
    session.endSession();
  }
}

export async function getOpenOrders(userId, { symbol } = {}) {
  const filter = { userId, status: { $in: ['NEW', 'PARTIALLY_FILLED'] } };
  if (symbol) filter.symbol = symbol.toUpperCase();
  return Order.find(filter).sort({ createdAt: -1 }).lean();
}

export async function getOrderHistory(userId, { symbol, status, page = 1, limit = 20 } = {}) {
  const filter = { userId };
  if (symbol) filter.symbol = symbol.toUpperCase();
  if (status) filter.status = status.toUpperCase();

  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const [items, totalItems] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    Order.countDocuments(filter),
  ]);

  return { items, pagination: { page: pageNum, limit: limitNum, totalItems, totalPages: Math.ceil(totalItems / limitNum) } };
}

export async function getOrderDetail(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, userId }).lean();
  if (!order) throw new SpotError('Không tìm thấy lệnh', 404);
  return order;
}

export async function getMyTrades(userId, { symbol, page = 1, limit = 20 } = {}) {
  const filter = { $or: [{ buyUserId: userId }, { sellUserId: userId }] };
  if (symbol) filter.symbol = symbol.toUpperCase();

  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const [items, totalItems] = await Promise.all([
    Trade.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    Trade.countDocuments(filter),
  ]);

  return { items, pagination: { page: pageNum, limit: limitNum, totalItems, totalPages: Math.ceil(totalItems / limitNum) } };
}

export { SpotError };