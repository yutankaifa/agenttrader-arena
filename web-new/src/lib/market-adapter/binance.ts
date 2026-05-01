import type { MarketAdapter, MarketCandleView, MarketQuote } from '@/lib/market-adapter/types';

const BASE_URL = process.env.BINANCE_BASE_URL || 'https://api.binance.us';
const API_KEY = process.env.BINANCE_API_KEY || '';

type BinanceFetchOptions = {
  live?: boolean;
  revalidate?: number;
};

async function binanceFetch(
  path: string,
  options: BinanceFetchOptions = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['X-MBX-APIKEY'] = API_KEY;
  }

  const fetchOptions: RequestInit & { next?: { revalidate: number } } = {
    headers,
  };
  if (options.live) {
    fetchOptions.cache = 'no-store';
  } else {
    fetchOptions.next = { revalidate: options.revalidate ?? 10 };
  }

  const response = await fetch(`${BASE_URL}${path}`, fetchOptions);
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function toBinanceSymbol(symbol: string) {
  const normalized = symbol.toUpperCase();
  if (normalized.endsWith('USDT') || normalized.endsWith('BUSD')) {
    return normalized;
  }
  return `${normalized}USDT`;
}

function fromBinanceSymbol(symbol: string) {
  return symbol.replace(/USDT$|BUSD$/, '');
}

export const binanceAdapter: MarketAdapter = {
  name: 'binance',
  market: 'crypto',

  async getQuote(symbol: string): Promise<MarketQuote | null> {
    try {
      const binanceSymbol = toBinanceSymbol(symbol);
      const data = await binanceFetch(`/api/v3/ticker/24hr?symbol=${binanceSymbol}`, {
        live: true,
      });

      return {
        market: 'crypto',
        provider: 'binance',
        symbol: fromBinanceSymbol(data.symbol),
        lastPrice: Number.parseFloat(data.lastPrice),
        bid: Number.parseFloat(data.bidPrice),
        ask: Number.parseFloat(data.askPrice),
        midpoint:
          (Number.parseFloat(data.bidPrice) + Number.parseFloat(data.askPrice)) / 2,
        spread: Number.parseFloat(data.askPrice) - Number.parseFloat(data.bidPrice),
        bidSize: Number.parseFloat(data.bidQty),
        askSize: Number.parseFloat(data.askQty),
        volume24h: Number.parseFloat(data.quoteVolume),
        change24h: Number.parseFloat(data.priceChangePercent),
        timestamp: new Date(data.closeTime).toISOString(),
      };
    } catch (error) {
      console.error(`[binance] getQuote(${symbol}) error:`, error);
      return null;
    }
  },

  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    try {
      const binanceSymbols = [...new Set(symbols.map(toBinanceSymbol))];
      if (!binanceSymbols.length) {
        return [];
      }

      const payload = encodeURIComponent(JSON.stringify(binanceSymbols));
      const data = await binanceFetch(`/api/v3/ticker/24hr?symbols=${payload}`, {
        live: true,
      });

      return Array.isArray(data)
        ? data.map(
            (item: Record<string, string>): MarketQuote => ({
              market: 'crypto',
              provider: 'binance',
              symbol: fromBinanceSymbol(item.symbol),
              lastPrice: Number.parseFloat(item.lastPrice),
              bid: Number.parseFloat(item.bidPrice),
              ask: Number.parseFloat(item.askPrice),
              midpoint:
                (Number.parseFloat(item.bidPrice) + Number.parseFloat(item.askPrice)) / 2,
              spread:
                Number.parseFloat(item.askPrice) - Number.parseFloat(item.bidPrice),
              bidSize: Number.parseFloat(item.bidQty),
              askSize: Number.parseFloat(item.askQty),
              volume24h: Number.parseFloat(item.quoteVolume),
              change24h: Number.parseFloat(item.priceChangePercent),
              timestamp: new Date(Number(item.closeTime)).toISOString(),
            })
          )
        : [];
    } catch (error) {
      console.error('[binance] getQuotes error:', error);
      return [];
    }
  },

  async getCandles(
    symbol: string,
    interval: string,
    limit = 100
  ): Promise<MarketCandleView[]> {
    try {
      const binanceSymbol = toBinanceSymbol(symbol);
      const data = await binanceFetch(
        `/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`,
        { revalidate: 10 }
      );

      return Array.isArray(data)
        ? data.map(
            (item: Array<string | number>): MarketCandleView => ({
              market: 'crypto',
              provider: 'binance',
              symbol: symbol.toUpperCase(),
              interval,
              openTime: new Date(Number(item[0])).toISOString(),
              closeTime: new Date(Number(item[6])).toISOString(),
              open: Number.parseFloat(String(item[1])),
              high: Number.parseFloat(String(item[2])),
              low: Number.parseFloat(String(item[3])),
              close: Number.parseFloat(String(item[4])),
              volume: Number.parseFloat(String(item[5])),
            })
          )
        : [];
    } catch (error) {
      console.error(`[binance] getCandles(${symbol}) error:`, error);
      return [];
    }
  },

  async getTopSymbols(limit = 20): Promise<string[]> {
    try {
      const data = await binanceFetch('/api/v3/ticker/24hr', {
        revalidate: 10,
      });

      return Array.isArray(data)
        ? data
            .filter(
              (item: Record<string, string>) =>
                typeof item.symbol === 'string' && item.symbol.endsWith('USDT')
            )
            .sort(
              (left: Record<string, string>, right: Record<string, string>) =>
                Number.parseFloat(right.quoteVolume) -
                Number.parseFloat(left.quoteVolume)
            )
            .slice(0, limit)
            .map((item: Record<string, string>) => fromBinanceSymbol(item.symbol))
        : [];
    } catch (error) {
      console.error('[binance] getTopSymbols error:', error);
      return ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
    }
  },
};
