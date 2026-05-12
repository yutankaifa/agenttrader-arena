import { Redis } from '@upstash/redis';
import { quoteKey } from 'agenttrader-types';
import { loadEnvFile } from './env';

type StockMessage = {
  ev?: unknown;
  sym?: unknown;
  p?: unknown;
  bp?: unknown;
  ap?: unknown;
  t?: unknown;
};

type QuoteState = {
  symbol: string;
  market: 'stock';
  provider: 'massive';
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
  bidSize: number | null;
  askSize: number | null;
  volume24h: number | null;
  change24h: number | null;
  timestamp: string;
};

function logJson(label: string, value: unknown): void {
  console.log(`\n[verify-stock] ${label}`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  loadEnvFile();
  const timeoutMs = Number(process.env.VERIFY_STOCK_TIMEOUT_MS || 120_000);

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    throw new Error(
      'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in workers/.env'
    );
  }

  if (!process.env.MASSIVE_API_KEY) {
    throw new Error('Missing MASSIVE_API_KEY in workers/.env');
  }

  const { MassiveStream } = await import('./stock-stream.ts');
  const redis = new Redis({ url: redisUrl, token: redisToken });
  const stream = new MassiveStream(redis);
  const internal = stream as MassiveStream & Record<string, any>;

  let firstStockMessage: StockMessage | null = null;
  let finished = false;

  const finish = async (code: number): Promise<void> => {
    if (finished) return;
    finished = true;

    try {
      stream.stop();
    } catch (error) {
      console.error('[verify-stock] stop failed:', error);
    }

    setTimeout(() => process.exit(code), 50);
  };

  const timeout = setTimeout(() => {
    console.error(
      `\n[verify-stock] Timed out after ${Math.round(timeoutMs / 1000)}s without observing a Redis write`
    );
    void finish(1);
  }, timeoutMs);

  const originalHandleMessage = internal.handleMessage.bind(stream);
  internal.handleMessage = (message: StockMessage) => {
    const firstRealtimeMessage =
      !firstStockMessage &&
      (message?.ev === 'Q' || message?.ev === 'T') &&
      typeof message?.sym === 'string';

    if (firstRealtimeMessage) {
      firstStockMessage = message;
      logJson('First stock message', message);
    }

    const result = originalHandleMessage(message);

    if (firstRealtimeMessage) {
      void internal.flushDirtyQuotes();
    }

    return result;
  };

  const originalFlushDirtyQuotes = internal.flushDirtyQuotes.bind(stream);
  internal.flushDirtyQuotes = async () => {
    await originalFlushDirtyQuotes();

    if (finished) return;

    const symbol =
      typeof firstStockMessage?.sym === 'string'
        ? firstStockMessage.sym.toUpperCase()
        : null;
    if (!symbol) return;

    const redisKey = quoteKey({ symbol, market: 'stock' });
    let storedValue: unknown = null;
    let readError: string | null = null;

    try {
      storedValue = await redis.get(redisKey);
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }

    if (storedValue === null && !readError) {
      return;
    }

    logJson('Redis readback', {
      key: redisKey,
      hasValue: storedValue !== null,
      value: storedValue,
      readError,
    });

    clearTimeout(timeout);
    await finish(storedValue !== null ? 0 : 1);
  };

  console.log('[verify-stock] Starting Massive stock stream verification...');
  console.log(
    `[verify-stock] Seed symbols: ${process.env.MASSIVE_SYMBOLS || 'none'}`
  );
  console.log(
    `[verify-stock] Timeout: ${Math.round(timeoutMs / 1000)}s`
  );

  await stream.start();

  const symbols = Array.isArray(internal.symbols) ? internal.symbols : [];
  const quoteState = internal.quoteState as Map<string, QuoteState> | undefined;
  const hydratedQuotes =
    quoteState instanceof Map
      ? symbols
          .map((symbol) => quoteState.get(symbol))
          .filter((quote): quote is QuoteState => Boolean(quote))
      : [];

  logJson('Watchlist after startup', symbols);
  logJson(
    'Hydrated snapshot state',
    hydratedQuotes.map((quote) => ({
      symbol: quote.symbol,
      lastPrice: quote.lastPrice,
      volume24h: quote.volume24h,
      change24h: quote.change24h,
      timestamp: quote.timestamp,
    }))
  );

  if (!hydratedQuotes.length) {
    console.error(
      '[verify-stock] No snapshot state was hydrated during startup; Massive REST may not be returning stock data.'
    );
  } else {
    console.log(
      '[verify-stock] Snapshot hydration succeeded; waiting for the first realtime Q/T event...'
    );
  }
}

void main().catch((error) => {
  console.error('\n[verify-stock] Verification failed:');
  console.error(error);
  process.exit(1);
});
