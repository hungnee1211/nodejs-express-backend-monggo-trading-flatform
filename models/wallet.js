import mongoose from 'mongoose';

/**
 * Wallet Schema - Ví testnet (KHÔNG phải tiền thật)
 * Mỗi user có nhiều wallet, mỗi wallet ứng với 1 loại coin (asset)
 */
const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    asset: {
      type: String, // ví dụ: 'USDT', 'BTC', 'ETH' (testnet token)
      required: true,
      uppercase: true,
      trim: true,
    },
    walletType: {
      type: String,
      enum: ['SPOT', 'FUNDING'],
      default: 'SPOT',
      required: true,
    },
    // Số dư khả dụng (có thể rút/giao dịch)
    available: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Available balance cannot be negative'],
    },
    // Số dư đang bị khóa (ví dụ đang có lệnh rút chờ xử lý)
    locked: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Locked balance cannot be negative'],
    },
    // Đánh dấu rõ đây là môi trường testnet, tránh nhầm lẫn dữ liệu thật
    isTestnet: {
      type: Boolean,
      default: true,
      immutable: true,
    },
  },
  { timestamps: true }
);

walletSchema.index({ userId: 1, asset: 1, walletType: 1 }, { unique: true });

// Tổng số dư = khả dụng + đang khóa
walletSchema.virtual('total').get(function () {
  return this.available + this.locked;
});

export default mongoose.model('Wallet', walletSchema);