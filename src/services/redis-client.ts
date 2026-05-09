/**
 * Redis connection singleton for event bus (Streams) and task queue (BullMQ).
 *
 * Env vars:
 *   REDIS_HOST  - default: localhost
 *   REDIS_PORT  - default: 6380
 */

import Redis from 'ioredis';

let redis: Redis | null = null;
let subscriberRedis: Redis | null = null;

function createConnection(name: string): Redis {
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380', 10),
    maxRetriesPerRequest: null, // required by BullMQ
    lazyConnect: true,
    connectionName: `novalogic-mcp:${name}`,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
  });
}

/** Main Redis connection (commands, publishing, BullMQ queues) */
export function getRedis(): Redis {
  if (!redis) {
    redis = createConnection('main');
  }
  return redis;
}

/** Dedicated subscriber connection (Redis Streams XREADGROUP blocks) */
export function getSubscriberRedis(): Redis {
  if (!subscriberRedis) {
    subscriberRedis = createConnection('subscriber');
  }
  return subscriberRedis;
}

/** Connect both Redis instances. Call once at startup. */
export async function initRedis(): Promise<void> {
  const r = getRedis();
  await r.connect();

  const s = getSubscriberRedis();
  await s.connect();
}

export async function shutdownRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (subscriberRedis) {
    await subscriberRedis.quit();
    subscriberRedis = null;
  }
}

/** Get Redis connection config for BullMQ (it creates its own connections) */
export function getRedisConfig() {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6380', 10),
    maxRetriesPerRequest: null as null,
  };
}
