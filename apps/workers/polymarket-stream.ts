/**
 * Polymarket Data Poller
 *
 * Polymarket's CLOB WebSocket requires auth and is unstable.
 * Instead, we poll the Gamma API every 5 seconds for top markets.
 * This gives near-real-time data with much better reliability.
 *
 * Gamma API (public, no auth):
 *   GET https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=20
 */

import type { RedisClient } from './redis-client';

import {
  WORKER_QUOTE_TTL_SECONDS,
  WORKER_SYMBOL_LIST_TTL_SECONDS,
} from './cache-contract';
import { buildStoredPolymarketQuote, type TopOfBook } from './polymarket-quote';
import { quoteKey } from './quote-contract';

const GAMMA_URL = 'https://gamma-api.polymarket.com';
const CLOB_URL = 'https://clob.polymarket.com';
const POLL_INTERVAL = 10000; // 10 seconds
const QUOTE_TTL = WORKER_QUOTE_TTL_SECONDS;
const LIST_TTL = WORKER_SYMBOL_LIST_TTL_SECONDS;
const PRICE_HISTORY_INTERVAL = '1d';
const PRICE_HISTORY_FIDELITY_MINUTES = 60;
const MAX_BATCH_HISTORY_MARKETS = 20;

type PriceHistoryPoint = {
  t: number;
  p: number | string;
};

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchBatchPriceHistories(tokenIds: string[]) {
  const historyMap = new Map<string, PriceHistoryPoint[]>();
  const uniqueTokenIds = [...new Set(tokenIds.filter(Boolean))];
  if (!uniqueTokenIds.length) {
    return historyMap;
  }

  const chunks = chunkArray(uniqueTokenIds, MAX_BATCH_HISTORY_MARKETS);
  for (const chunk of chunks) {
    const response = await fetch(`${CLOB_URL}/batch-prices-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: chunk,
        interval: PRICE_HISTORY_INTERVAL,
        fidelity: PRICE_HISTORY_FIDELITY_MINUTES,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `CLOB batch-prices-history error: ${response.status} ${response.statusText}`
      );
    }

    const payload = await response.json();
    const history = payload?.history ?? {};
    for (const tokenId of chunk) {
      historyMap.set(tokenId, Array.isArray(history[tokenId]) ? history[tokenId] : []);
    }
  }

  return historyMap;
}

function parseTopOfBook(payload: {
  bids?: Array<{ price: string }>;
  asks?: Array<{ price: string }>;
} | null | undefined): TopOfBook {
  const bid = payload?.bids?.length ? parseFloat(payload.bids[0].price) : null;
  const ask = payload?.asks?.length ? parseFloat(payload.asks[0].price) : null;

  return {
    bid: Number.isFinite(bid) ? bid : null,
    ask: Number.isFinite(ask) ? ask : null,
  };
}

async function fetchTopOfBook(tokenId: string) {
  const response = await fetch(`${CLOB_URL}/book?token_id=${tokenId}`);
  if (!response.ok) {
    throw new Error(`CLOB book error: ${response.status} ${response.statusText}`);
  }

  return parseTopOfBook(await response.json());
}

async function fetchBatchTopOfBooks(tokenIds: string[]) {
  const bookMap = new Map<string, TopOfBook>();
  const uniqueTokenIds = [...new Set(tokenIds.filter(Boolean))];
  if (!uniqueTokenIds.length) {
    return bookMap;
  }

  const chunks = chunkArray(uniqueTokenIds, MAX_BATCH_HISTORY_MARKETS);
  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (tokenId) => [tokenId, await fetchTopOfBook(tokenId)] as const)
    );

    for (const [index, tokenId] of chunk.entries()) {
      const result = results[index];
      if (result?.status === 'fulfilled') {
        bookMap.set(tokenId, result.value[1]);
      } else {
        bookMap.set(tokenId, { bid: null, ask: null });
      }
    }
  }

  return bookMap;
}

function computeChange24h(
  history: PriceHistoryPoint[] | undefined,
  currentPrice: number
): number | null {
  if (!Array.isArray(history) || !history.length || !Number.isFinite(currentPrice)) {
    return null;
  }

  const normalized = history
    .map((point) => ({
      t: Number(point.t),
      p: Number(point.p),
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p))
    .sort((left, right) => left.t - right.t);

  if (!normalized.length) {
    return null;
  }

  const baseline = normalized[0]?.p;
  if (!Number.isFinite(baseline) || baseline === 0) {
    return null;
  }

  return ((currentPrice - baseline) / baseline) * 100;
}

export class PolymarketPoller {
  private redis: RedisClient;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;
  private limit: number;

  constructor(redis: RedisClient, limit = 20) {
    this.redis = redis;
    this.limit = limit;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[polymarket] Starting poller (every ${POLL_INTERVAL / 1000}s, top ${this.limit} markets)`);
    
    // Run immediately, then on interval
    this.poll();
    this.intervalHandle = setInterval(() => this.poll(), POLL_INTERVAL);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      // Fetch top markets by 24h volume
      const res = await fetch(
        `${GAMMA_URL}/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=${this.limit}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (!res.ok) {
        console.error(`[polymarket] Gamma API error: ${res.status}`);
        return;
      }

      const markets = await res.json();
      const allTokenIds = markets.flatMap((market: any) =>
        this.parseClobTokenIds(market.clobTokenIds)
      );
      const priceHistoryMap = await fetchBatchPriceHistories(allTokenIds);
      const topOfBookMap = await fetchBatchTopOfBooks(allTokenIds);
      const symbols: string[] = [];
      const pipeline = this.redis.pipeline();
      const quoteTimestamp = new Date().toISOString();

      for (const m of markets) {
        const slug = m.slug;
        if (!slug) continue;

        symbols.push(slug);

        const prices = m.outcomePrices ? JSON.parse(m.outcomePrices) : [];
        const yesPrice = prices.length ? parseFloat(prices[0]) : 0.5;
        const tokenIds = this.parseClobTokenIds(m.clobTokenIds);
        const volume24h = parseFloat(m.volume24hr || '0');
        const quote = buildStoredPolymarketQuote({
          symbol: slug,
          lastPrice: yesPrice,
          volume24h,
          change24h: computeChange24h(priceHistoryMap.get(tokenIds[0]), yesPrice),
          timestamp: quoteTimestamp,
          book: tokenIds[0] ? (topOfBookMap.get(tokenIds[0]) ?? null) : null,
        });

        pipeline.set(
          quoteKey({
            symbol: slug,
            market: 'prediction',
          }),
          JSON.stringify(quote),
          { ex: QUOTE_TTL }
        );

        const outcomeNames = m.outcomes ? JSON.parse(m.outcomes) : [];
        for (let index = 0; index < tokenIds.length; index++) {
          const tokenId = tokenIds[index];
          const outcomePrice = prices.length
            ? parseFloat(prices[index] ?? prices[0])
            : yesPrice;
          pipeline.set(
            quoteKey({
              symbol: slug,
              market: 'prediction',
              outcomeId: tokenId,
            }),
            JSON.stringify(
              buildStoredPolymarketQuote({
                symbol: slug,
                lastPrice: outcomePrice,
                volume24h,
                change24h: computeChange24h(priceHistoryMap.get(tokenId), outcomePrice),
                timestamp: quoteTimestamp,
                book: topOfBookMap.get(tokenId) ?? null,
                outcomeId: tokenId,
                outcomeName: outcomeNames[index] ?? null,
              })
            ),
            { ex: QUOTE_TTL }
          );
        }
      }

      // Update symbol list
      pipeline.set(
        'market:quotes:prediction',
        JSON.stringify(symbols),
        { ex: LIST_TTL }
      );

      await pipeline.exec();
    } catch (err) {
      console.error('[polymarket] Poll error:', err);
    }
  }

  private parseClobTokenIds(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}
