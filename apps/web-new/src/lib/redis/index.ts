export { getRedis, isRedisConfigured, pingRedis } from '@/lib/redis/client';
export {
  addRecentSymbols,
  getAllQuotesByMarket,
  getCacheStatus,
  getQuote,
  getQuotes,
  getRecentSymbolList,
  getSymbolList,
  getTrackedSymbolList,
  hasFreshData,
  setQuote,
  setQuotes,
  setSymbolList,
} from '@/lib/redis/market-cache';
