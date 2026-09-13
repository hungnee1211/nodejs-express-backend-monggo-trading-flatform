import mongoose from 'mongoose';

/**
 * Transaction Schema - Lịch sử nạp / rút trên testnet
 */
const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    asset: {
      type: String,
      required: true,
      uppercase: true,
    },
    type: {
      type: String,
      enum: ['DEPOSIT', 'WITHDRAW', 'TRANSFER_IN', 'TRANSFER_OUT'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.00000001, 'Amount must be greater than 0'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
    },
    // Chuỗi mô phỏng địa chỉ / mạng lưới (testnet), KHÔNG phải địa chỉ thật
    network: {
      type: String,
      default: 'TESTNET',
    },
    address: {
      type: String, // địa chỉ giả lập cho demo
    },
    // Khóa idempotency để chống gửi trùng request (double submit)
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    note: {
      type: String,
      maxlength: 255,
    },
    // Số dư sau khi giao dịch hoàn tất (để audit / hiển thị lịch sử)
    balanceAfter: {
      type: Number,
    },
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Transaction', transactionSchema);