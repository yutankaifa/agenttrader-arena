/**
 * Unified Redis adapter — supports both Upstash (HTTP/REST) and standard Redis (TCP/RESP).
 *
 * Resolution order:
 *   1. REDIS_URL env → ioredis (standard Redis, e.g. redis://localhost:6379)
 *   2. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN → @upstash/redis (HTTP)
 *   3. Neither → exit with error
 */

import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';

// ── Minimal interface consumed by the stream classes ──

export interface RedisPipeline {
  set(key: string, value: string, opts?: { ex?: number }): void;
  get<T = string>(key: string): void;
  exec(): Promise<unknown[]>;
}

export interface RedisClient {
  ping(): Promise<string>;
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  pipeline(): RedisPipeline;
}

// ── Upstash adapter (pass-through, already matches) ──

class UpstashAdapter implements RedisClient {
  private client: UpstashRedis;
  constructor(url: string, token: string) {
    this.client = new UpstashRedis({ url, token });
  }
  async ping(): Promise<string> {
    return this.client.ping();
  }
  async get<T = string>(key: string): Promise<T | null> {
    return this.client.get<T>(key);
  }
  async set(key: string, value: string, opts?: { ex?: number }): Promise<unknown> {
    return this.client.set(key, value, opts);
  }
  pipeline(): RedisPipeline {
    const p = this.client.pipeline();
    return {
      set(key: string, value: string, opts?: { ex?: number }) {
        p.set(key, value, opts);
      },
      get<T = string>(key: string) {
        p.get<T>(key);
      },
      async exec() {
        return p.exec();
      },
    };
  }
}

// ── ioredis adapter ──

class IORedisAdapter implements RedisClient {
  private client: IORedis;
  constructor(url: string) {
    this.client = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }
  async ping(): Promise<string> {
    return this.client.ping();
  }
  async get<T = string>(key: string): Promise<T | null> {
    const val = await this.client.get(key);
    if (val === null) return null;
    // Upstash auto-deserialises JSON strings; mirror that behaviour
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as unknown as T;
    }
  }
  async set(key: string, value: string, opts?: { ex?: number }): Promise<unknown> {
    if (opts?.ex) {
      return this.client.set(key, value, 'EX', opts.ex);
    }
    return this.client.set(key, value);
  }
  pipeline(): RedisPipeline {
    const p = this.client.pipeline();
    return {
      set(key: string, value: string, opts?: { ex?: number }) {
        if (opts?.ex) {
          p.set(key, value, 'EX', opts.ex);
        } else {
          p.set(key, value);
        }
      },
      get<T = string>(key: string) {
        p.get(key);
      },
      async exec() {
        const results = await p.exec();
        // ioredis pipeline returns [[err, result], ...]; flatten to match Upstash
        return (results ?? []).map(([err, val]) => {
          if (err) throw err;
          return val;
        });
      },
    };
  }
}

// ── Factory ──

export function createRedisClient(): { client: RedisClient; label: string } {
  const redisUrl = process.env.REDIS_URL;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl) {
    return {
      client: new IORedisAdapter(redisUrl),
      label: redisUrl.replace(/\/\/([^:@]+)(:[^@]+)?@/, '//$1:***@'),
    };
  }

  if (upstashUrl && upstashToken) {
    return {
      client: new UpstashAdapter(upstashUrl, upstashToken),
      label: upstashUrl.replace(/^(https?:\/\/)([^:]+)(.*)/, '$1***$3'),
    };
  }

  console.error('❌ Missing Redis configuration. Provide one of:');
  console.error('   • REDIS_URL           — standard Redis (e.g. redis://localhost:6379)');
  console.error('   • UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN — Upstash HTTP Redis');
  process.exit(1);
}
