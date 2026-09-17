import mongoose from 'mongoose';

/**
 * Order - Lệnh giao dịch spot (LIMIT/MARKET, BUY/SELL)
 * Dùng cho mô hình order book đơn giản, khớp lệnh price-time priority (testnet).
 */
const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    symbol: { type: String, required: true, uppercase: true, index: true }, // vd: BTCUSDT
    baseAsset: { type: String, required: true, uppercase: true }, // vd: BTC
    quoteAsset: { type: String, required: true, uppercase: true }, // vd: USDT

    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    type: { type: String, enum: ['LIMIT', 'MARKET'], required: true },

    // Với LIMIT: giá đặt lệnh. Với MARKET: null khi tạo, sẽ không dùng để khớp
    price: { type: Number, default: null },

    // Số lượng base asset muốn mua/bán.
    // Với MARKET BUY theo quoteOrderQty, quantity ban đầu = 0, sẽ được engine cập nhật lại sau khi khớp
    quantity: { type: Number, required: true, default: 0 },
    filledQuantity: { type: Number, default: 0 },
    avgFillPrice: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED'],
      default: 'NEW',
      index: true,
    },

    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

orderSchema.index({ symbol: 1, side: 1, status: 1, price: 1, createdAt: 1 });
orderSchema.index({ userId: 1, symbol: 1, status: 1 });

export default mongoose.model('Order', orderSchema);