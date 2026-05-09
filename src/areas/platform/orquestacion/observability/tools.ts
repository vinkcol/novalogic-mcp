/**
 * Observability tools — tracing, metrics, and health dashboard.
 * 6 tools with prefix obs_
 */

import type { ToolDefinition } from '../../../../shared/types.js';
import {
  getTraces,
  getMetricsSummary,
  recordMetric,
  getHealthDashboard,
  generateTraceId,
} from '../../../../services/observability.js';
import { getQueueStats } from '../../../../services/task-queue.js';
import { getAgentCard } from '../../../../services/agent-protocol.js';

export const tools: Record<string, ToolDefinition> = {
  obs_trace_get: {
    description:
      '[Observability] Get all spans for a specific trace ID. Shows the full execution path across agents and tools.',
    inputSchema: {
      type: 'object',
      properties: {
        trace_id: { type: 'string', description: 'Trace ID (e.g. "tr_abc123...")' },
      },
      required: ['trace_id'],
    },
    handler: async (args: any) => {
      const spans = await getTraces({ traceId: args.trace_id, limit: 200 });
      return {
        trace_id: args.trace_id,
        span_count: spans.length,
        spans,
      };
    },
  },

  obs_trace_search: {
    description:
      '[Observability] Search traces by agent, tool, or time range. Useful for debugging and auditing agent interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Filter by agent ID' },
        tool: { type: 'string', description: 'Filter by tool name' },
        since: {
          type: 'string',
          description: 'ISO timestamp — show traces after this time',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
    handler: async (args: any) => {
      const traces = await getTraces({
        agent: args.agent,
        tool: args.tool,
        since: args.since,
        limit: args.limit,
      });
      return { count: traces.length, traces };
    },
  },

  obs_metrics_record: {
    description:
      '[Observability] Record a custom metric. Supports counter, gauge, and histogram types.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Metric name (dot-notation, e.g. "sales.orders.created")',
        },
        value: { type: 'number', description: 'Metric value' },
        type: {
          type: 'string',
          enum: ['counter', 'gauge', 'histogram'],
          description: 'Metric type (default: counter)',
        },
        labels: {
          type: 'object',
          description: 'Key-value labels for filtering',
        },
        agent: { type: 'string', description: 'Agent that recorded this metric' },
      },
      required: ['name', 'value'],
    },
    handler: async (args: any) => {
      await recordMetric(args.name, args.value, {
        type: args.type,
        labels: args.labels,
        agent: args.agent,
      });
      return { ok: true, metric: args.name, value: args.value };
    },
  },

  obs_metrics_query: {
    description:
      '[Observability] Query metric summaries — aggregated stats (total, avg, min, max) per metric name.',
    inputSchema: {
      type: 'object',
      properties: {
        metric_name: { type: 'string', description: 'Filter by metric name' },
        agent: { type: 'string', description: 'Filter by agent' },
        since: { type: 'string', description: 'ISO timestamp' },
        limit: { type: 'number' },
      },
    },
    handler: async (args: any) =>
      getMetricsSummary({
        metricName: args.metric_name,
        agent: args.agent,
        since: args.since,
        limit: args.limit,
      }),
  },

  obs_health: {
    description:
      '[Observability] Get the full system health dashboard: agent statuses, trace activity, queue stats, workflow states, and top metrics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const [dashboard, queueStats] = await Promise.all([
        getHealthDashboard(),
        getQueueStats().catch(() => null),
      ]);
      return {
        ...dashboard,
        task_queue: queueStats,
        timestamp: new Date().toISOString(),
      };
    },
  },

  obs_agent_status: {
    description:
      '[Observability] Get detailed status of a specific agent — card info, recent traces, and queue activity.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID to check' },
      },
      required: ['agent_id'],
    },
    handler: async (args: any) => {
      const [card, recentTraces] = await Promise.all([
        getAgentCard(args.agent_id),
        getTraces({ agent: args.agent_id, limit: 10 }),
      ]);

      return {
        card: card || { error: 'Agent card not found' },
        recent_traces: recentTraces,
      };
    },
  },
};
