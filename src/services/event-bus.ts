/**
 * Event Bus — Redis Streams-based pub/sub for inter-agent communication.
 *
 * Each event type maps to a Redis Stream: `nova:events:{type}`
 * Consumer groups allow multiple agents to subscribe independently.
 * Dead Letter Queue at `nova:events:dlq` for failed processing.
 */

import { randomUUID } from 'node:crypto';
import { getRedis, getSubscriberRedis } from './redis-client.js';
import { recordMetric } from './observability.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NovaEvent {
  id?: string;
  type: string;
  source: string;
  traceId?: string;
  payload: Record<string, unknown>;
  timestamp?: number;
}

export interface EventSubscription {
  id: string;
  eventType: string;
  consumerGroup: string;
  agentId: string;
  active: boolean;
}

// ── State ──────────────────────────────────────────────────────────────────

const STREAM_PREFIX = 'nova:events:';
const DLQ_STREAM = 'nova:events:dlq';
const MAX_STREAM_LEN = 10000;
const MAX_RETRIES = 3;

const subscriptions: EventSubscription[] = [];
let busRunning = false;

// ── Publishing ─────────────────────────────────────────────────────────────

export async function publishEvent(event: NovaEvent): Promise<string> {
  const redis = getRedis();
  const stream = STREAM_PREFIX + event.type;
  const eventData = {
    ...event,
    id: event.id || randomUUID(),
    timestamp: event.timestamp || Date.now(),
  };

  const streamId = await redis.xadd(
    stream,
    'MAXLEN',
    '~',
    String(MAX_STREAM_LEN),
    '*',
    'data',
    JSON.stringify(eventData),
  );

  recordMetric('events.published', 1, {
    labels: { type: event.type, source: event.source },
  }).catch(() => {});

  return streamId!;
}

// ── Subscription Management ────────────────────────────────────────────────

export async function subscribe(opts: {
  eventType: string;
  agentId: string;
}): Promise<EventSubscription> {
  const redis = getRedis();
  const stream = STREAM_PREFIX + opts.eventType;
  const group = `agent:${opts.agentId}`;

  // Create consumer group if not exists
  try {
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
  } catch (err: any) {
    if (!err.message?.includes('BUSYGROUP')) throw err;
  }

  const sub: EventSubscription = {
    id: randomUUID(),
    eventType: opts.eventType,
    consumerGroup: group,
    agentId: opts.agentId,
    active: true,
  };

  subscriptions.push(sub);
  return sub;
}

export function getSubscriptions(): EventSubscription[] {
  return [...subscriptions];
}

// ── Event History ──────────────────────────────────────────────────────────

export async function getEventHistory(
  eventType: string,
  opts?: { count?: number; since?: string },
): Promise<NovaEvent[]> {
  const redis = getRedis();
  const stream = STREAM_PREFIX + eventType;
  const start = opts?.since || '-';
  const count = opts?.count || 50;

  const results = await redis.xrevrange(stream, '+', start, 'COUNT', count);

  return results.map(([id, fields]: [string, string[]]) => {
    const data = JSON.parse(fields[1]);
    return { ...data, id: id };
  });
}

// ── Dead Letter Queue ──────────────────────────────────────────────────────

export async function getDeadLetterQueue(count?: number): Promise<any[]> {
  const redis = getRedis();
  const results = await redis.xrevrange(DLQ_STREAM, '+', '-', 'COUNT', count || 50);

  return results.map(([id, fields]: [string, string[]]) => {
    const data = JSON.parse(fields[1]);
    return { dlq_id: id, ...data };
  });
}

export async function replayDeadLetter(dlqId: string): Promise<string> {
  const redis = getRedis();

  // Read the DLQ entry
  const entries = await redis.xrange(DLQ_STREAM, dlqId, dlqId);
  if (entries.length === 0) throw new Error(`DLQ entry not found: ${dlqId}`);

  const data = JSON.parse(entries[0][1][1]);
  const originalType = data.originalType || data.type;
  const stream = STREAM_PREFIX + originalType;

  // Re-publish to original stream
  const newId = await redis.xadd(
    stream,
    'MAXLEN',
    '~',
    String(MAX_STREAM_LEN),
    '*',
    'data',
    JSON.stringify({ ...data, replayed: true, replayedAt: Date.now() }),
  );

  recordMetric('events.dlq.replayed', 1, {
    labels: { type: originalType },
  }).catch(() => {});

  return newId!;
}

async function sendToDeadLetter(
  event: NovaEvent,
  error: string,
  retryCount: number,
): Promise<void> {
  const redis = getRedis();
  await redis.xadd(
    DLQ_STREAM,
    'MAXLEN',
    '~',
    '5000',
    '*',
    'data',
    JSON.stringify({
      ...event,
      originalType: event.type,
      error,
      retryCount,
      dlqAt: Date.now(),
    }),
  );

  recordMetric('events.dlq.added', 1, {
    labels: { type: event.type },
  }).catch(() => {});
}

// ── Event Bus Lifecycle ────────────────────────────────────────────────────

export async function initEventBus(): Promise<void> {
  busRunning = true;
}

export async function shutdownEventBus(): Promise<void> {
  busRunning = false;
  subscriptions.length = 0;
}

// ── Stream Info ────────────────────────────────────────────────────────────

export async function getStreamInfo(eventType: string): Promise<any> {
  const redis = getRedis();
  const stream = STREAM_PREFIX + eventType;
  try {
    const info = await redis.xinfo('STREAM', stream) as any[];
    // Parse XINFO STREAM flat array into object
    const obj: Record<string, any> = {};
    for (let i = 0; i < info.length; i += 2) {
      obj[String(info[i])] = info[i + 1];
    }
    return obj;
  } catch (err: any) {
    if (err.message?.includes('no such key')) {
      return { exists: false, stream: eventType };
    }
    throw err;
  }
}
