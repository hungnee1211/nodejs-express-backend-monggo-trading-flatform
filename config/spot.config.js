// Cấu hình các cặp giao dịch spot hỗ trợ (testnet)
export const SYMBOLS = {
  BTCUSDT: { baseAsset: 'BTC', quoteAsset: 'USDT', pricePrecision: 2, qtyPrecision: 6, minQty: 0.00001, minNotional: 5 },
  ETHUSDT: { baseAsset: 'ETH', quoteAsset: 'USDT', pricePrecision: 2, qtyPrecision: 5, minQty: 0.0001, minNotional: 5 },
  BNBUSDT: { baseAsset: 'BNB', quoteAsset: 'USDT', pricePrecision: 2, qtyPrecision: 4, minQty: 0.001, minNotional: 5 },
};

export const getSymbolConfig = (symbol) => SYMBOLS[symbol?.toUpperCase()] || null;

export const round = (num, precision) => Number(Number(num).toFixed(precision));