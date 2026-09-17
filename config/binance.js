import { Spot } from "@binance/connector";

/**
 * Binance Spot API client config
 * Chỉ dùng cho môi trường testnet/demo - không dùng API key thật
 */
const binanceClient = new Spot(
  process.env.BINANCE_API_KEY || '',
  process.env.BINANCE_API_SECRET || '',
  {
    baseURL: process.env.BINANCE_BASE_URL || 'https://testnet.binance.vision',
  }
);

export default binanceClient;