import { WebsocketStream } from "@binance/connector";
import Order from "../models/order.js"; // Đảm bảo đường dẫn model Order của bạn chính xác

/**
 * Binance WebSocket Service
 * Dùng @binance/connector thay vì binance-api-node
 */
class BinanceSocketService {
  constructor() {
    this.wsClient = null;
    this.listenKey = null;
  }

  // Khởi động lắng nghe WebSocket
  async startUserDataStream() {
    try {
      console.log('Đang khởi động kết nối Binance WebSocket...');

      // Khởi tạo WebSocket client cho testnet
      this.wsClient = new WebsocketStream({
        baseURL: process.env.BINANCE_WS_BASE_URL || 'wss://testnet.binance.vision',
      });

      // Setup callbacks
      this.wsClient.callbacks = {
        open: () => console.log('Binance WS: Connected'),
        close: () => console.log('Binance WS: Disconnected'),
        error: (err) => console.error('Binance WS Error:', err),
        message: (data) => {
          // Parse message nếu là string
          const event = typeof data === 'string' ? JSON.parse(data) : data;
          this.handleEvent(event);
        },
      };

      // Đăng ký stream cần thiết (Ví dụ: public trade hoặc stream cá nhân theo listenKey)
      this.wsClient.subscribe(['btcusdt@trade']);

      console.log('Đã kết nối tới Binance WebSocket thành công.');
    } catch (error) {
      console.error('Lỗi khi khởi động Binance WebSocket:', error);
      setTimeout(() => this.startUserDataStream(), 5000);
    }
  }

  async handleEvent(event) {
    // 1. Xử lý sự kiện khớp lệnh / thay đổi trạng thái lệnh cá nhân (User Data Stream)
    if (event.e === 'executionReport') {
      const {
        s: symbol,          // Cặp giao dịch (VD: BTCUSDT)
        i: orderId,         // ID lệnh trên sàn
        X: orderStatus,     // Trạng thái mới (NEW, PARTIALLY_FILLED, FILLED, CANCELED...)
        z: executedQty,     // Khối lượng đã khớp
        p: price,           // Giá lệnh
        S: side,            // BUY hoặc SELL
      } = event;

      console.log(`[Binance WS] Lệnh ${orderId} (${symbol}) - ${side} đã đổi trạng thái thành: ${orderStatus}`);

      try {
        // Cập nhật trạng thái lệnh trực tiếp vào Database (MongoDB)
        const updatedOrder = await Order.findOneAndUpdate(
          { orderId: orderId },
          { 
            status: orderStatus,
            executedQty: executedQty,
            updatedAt: Date.now()
          },
          { new: true }
        );

        if (updatedOrder) {
          console.log(`[Database] Đã cập nhật lệnh ${orderId} thành công.`);
        }
      } catch (dbError) {
        console.error('Lỗi cập nhật Database khi nhận executionReport:', dbError);
      }
    }

    // 2. Xử lý sự kiện public trade stream (Khớp lệnh thị trường chung)
    if (event.e === 'trade') {
      // Logic xử lý giá thị trường real-time (nếu cần cập nhật cache hoặc broadcast qua Socket.io cho frontend)
      const { s: symbol, p: price, q: quantity, m: isBuyerMaker } = event;
      // Ví dụ: Cập nhật giá mới nhất vào Redis hoặc biến global để app sử dụng
    }
  }

  stopUserDataStream() {
    if (this.wsClient) {
      this.wsClient.wsConnection?.close();
      this.wsClient = null;
      console.log('Đã đóng kết nối WebSocket Binance.');
    }
  }
}

export default new BinanceSocketService();