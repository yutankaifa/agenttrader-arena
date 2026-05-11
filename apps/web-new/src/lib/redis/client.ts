import { createRequire } from 'node:module';

type RedisClient = {
  ping(): Promise<string>;
  pipeline(): {
    set(key: string, value: string, options?: { ex?: number }): void;
    get<T>(key: string): void;
    exec(): Promise<unknown[]>;
  };
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>;
  get<T>(key: string): Promise<T | null>;
};

const require = createRequire(import.meta.url);
let redisClient: RedisClient | null = null;

function createUpstashClient(url: string, token: string): RedisClient {
  const { Redis } = require('@upstash/redis') as {
    Redis: new (input: { url: string; token: string }) => RedisClient;
  };
  return new Redis({ url, token });
}

function createIORedisClient(url: string): RedisClient {
  const IORedis = require('ioredis') as {
    new (
      url: string,
      options?: { lazyConnect?: boolean; maxRetriesPerRequest?: number }
    ): {
      ping(): Promise<string>;
      get(key: string): Promise<string | null>;
      set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
      pipeline(): {
        set(key: string, value: string, ...args: unknown[]): unknown;
        get(key: string): unknown;
        exec(): Promise<Array<[Error | null, unknown]>>;
      };
    };
  };
  const client = new IORedis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });

  return {
    async ping() {
      return client.ping();
    },
    async get<T>(key: string): Promise<T | null> {
      const val = await client.get(key);
      if (val === null) return null;
      try {
        return JSON.parse(val) as T;
      } catch {
        return val as unknown as T;
      }
    },
    async set(key: string, value: string, opts?: { ex?: number }) {
      if (opts?.ex) {
        return client.set(key, value, 'EX', opts.ex);
      }
      return client.set(key, value);
    },
    pipeline() {
      const p = client.pipeline();
      return {
        set(key: string, value: string, opts?: { ex?: number }) {
          if (opts?.ex) {
            p.set(key, value, 'EX', opts.ex);
          } else {
            p.set(key, value);
          }
        },
        get<T>(_key: string) {
          p.get(_key);
        },
        async exec() {
          const results = await p.exec();
          return (results ?? []).map(([err, val]) => {
            if (err) throw err;
            return val;
          });
        },
      };
    },
  };
}

export function getRedis() {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl) {
    redisClient = createIORedisClient(redisUrl);
    return redisClient;
  }

  if (upstashUrl && upstashToken) {
    redisClient = createUpstashClient(upstashUrl, upstashToken);
    return redisClient;
  }

  throw new Error(
    '[redis] Missing Redis configuration. Provide REDIS_URL or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN'
  );
}

export function isRedisConfigured() {
  return Boolean(
    process.env.REDIS_URL ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

export async function pingRedis() {
  try {
    if (!isRedisConfigured()) {
      return false;
    }

    const result = await getRedis().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
