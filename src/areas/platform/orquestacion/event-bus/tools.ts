/**
 * Event Bus tools — Redis Streams pub/sub for inter-agent events.
 * 6 tools with prefix events_
 */

import type { ToolDefinition } from '../../../../shared/types.js';
import {
  publishEvent,
  subscribe,
  getSubscriptions,
  getEventHistory,
  getDeadLetterQueue,
  replayDeadLetter,
  getStreamInfo,
} from '../../../../services/event-bus.js';

export const tools: Record<string, ToolDefinition> = {
  events_publish: {
    description:
      '[Event Bus] Publish a typed event to the Redis Streams event bus. Other agents can subscribe to event types. Use dot-notation for event types (e.g. "sales.order.created", "workflow.step.completed").',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Event type (dot-notation, e.g. "sales.order.created")',
        },
        source: {
          type: 'string',
          description: 'Agent ID that produced this event',
        },
        payload: {
          type: 'object',
          description: 'Event data',
        },
        trace_id: {
          type: 'string',
          description: 'Optional trace ID for correlation',
        },
      },
      required: ['type', 'source', 'payload'],
    },
    handler: async (args: any) => {
      const streamId = await publishEvent({
        type: args.type,
        source: args.source,
        payload: args.payload,
        traceId: args.trace_id,
      });
      return { ok: true, stream_id: streamId, type: args.type };
    },
  },

  events_history: {
    description:
      '[Event Bus] Get recent events for a specific event type. Returns events in reverse chronological order.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type: {
          type: 'string',
          description: 'Event type to query (e.g. "sales.order.created")',
        },
        count: { type: 'number', description: 'Max events to return (default 50)' },
        since: {
          type: 'string',
          description: 'Redis stream ID to start from (optional)',
        },
      },
      required: ['event_type'],
    },
    handler: async (args: any) => {
      const events = await getEventHistory(args.event_type, {
        count: args.count,
        since: args.since,
      });
      return { event_type: args.event_type, count: events.length, events };
    },
  },

  events_dlq: {
    description:
      '[Event Bus] View the dead letter queue — events that failed processing after max retries.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Max entries to return (default 50)' },
      },
    },
    handler: async (args: any) => {
      const entries = await getDeadLetterQueue(args.count);
      return { dlq_size: entries.length, entries };
    },
  },

  events_dlq_replay: {
    description:
      '[Event Bus] Replay a dead letter event — re-publish it to its original stream for reprocessing.',
    inputSchema: {
      type: 'object',
      properties: {
        dlq_id: {
          type: 'string',
          description: 'Dead letter queue entry ID',
        },
      },
      required: ['dlq_id'],
    },
    handler: async (args: any) => {
      const newId = await replayDeadLetter(args.dlq_id);
      return { ok: true, new_stream_id: newId };
    },
  },

  events_subscribe: {
    description:
      '[Event Bus] Register a subscription for an agent to an event type. Creates a Redis consumer group for the agent.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type: {
          type: 'string',
          description: 'Event type to subscribe to',
        },
        agent_id: {
          type: 'string',
          description: 'Agent that will receive events',
        },
      },
      required: ['event_type', 'agent_id'],
    },
    handler: async (args: any) => {
      const sub = await subscribe({
        eventType: args.event_type,
        agentId: args.agent_id,
      });
      return { ok: true, subscription: sub };
    },
  },

  events_subscriptions: {
    description:
      '[Event Bus] List all active event subscriptions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => ({
      subscriptions: getSubscriptions(),
    }),
  },
};
