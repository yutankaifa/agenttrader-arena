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

export function getRedis() {
  if (redisClient) {
    return redisClient;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      '[redis] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN'
    );
  }

  const { Redis } = require('@upstash/redis') as {
    Redis: new (input: { url: string; token: string }) => RedisClient;
  };
  redisClient = new Redis({ url, token });
  return redisClient;
}

export function isRedisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
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
