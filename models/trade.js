import mongoose from 'mongoose';

/**
 * Trade - Bản ghi mỗi lần khớp lệnh giữa 1 lệnh mua và 1 lệnh bán
 */
const tradeSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },

    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    quoteAmount: { type: Number, required: true }, // = price * quantity

    buyOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    sellOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },

    buyUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

tradeSchema.index({ symbol: 1, createdAt: -1 });

export default mongoose.model('Trade', tradeSchema);