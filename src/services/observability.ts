/**
 * Observability service: structured tracing, metrics, and health dashboard.
 *
 * Traces follow a traceId/spanId model stored in PostgreSQL.
 * Metrics are time-series counters/gauges stored in obs_metrics.
 */

import { randomUUID } from 'node:crypto';
import { query } from '../db/client.js';

// ── ID Generation ──────────────────────────────────────────────────────────

export function generateTraceId(): string {
  return 'tr_' + randomUUID().replace(/-/g, '').slice(0, 24);
}

export function generateSpanId(): string {
  return 'sp_' + randomUUID().replace(/-/g, '').slice(0, 16);
}

// ── Span Types ─────────────────────────────────────────────────────────────

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  agent?: string;
  tool?: string;
  startedAt: Date;
}

// ── Span Lifecycle ─────────────────────────────────────────────────────────

export async function startSpan(opts: {
  traceId: string;
  parentSpanId?: string;
  operation: string;
  agent?: string;
  tool?: string;
  inputSummary?: string;
}): Promise<Span> {
  const span: Span = {
    traceId: opts.traceId,
    spanId: generateSpanId(),
    parentSpanId: opts.parentSpanId,
    operation: opts.operation,
    agent: opts.agent,
    tool: opts.tool,
    startedAt: new Date(),
  };

  await query(
    `INSERT INTO obs_traces (trace_id, parent_span_id, span_id, operation, agent, tool, input_summary, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      span.traceId,
      span.parentSpanId || null,
      span.spanId,
      span.operation,
      span.agent || null,
      span.tool || null,
      opts.inputSummary || null,
      span.startedAt,
    ],
  );

  return span;
}

export async function endSpan(
  span: Span,
  result: {
    status: 'ok' | 'error';
    outputSummary?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const endedAt = new Date();
  const durationMs = endedAt.getTime() - span.startedAt.getTime();

  await query(
    `UPDATE obs_traces
     SET status = $1, duration_ms = $2, output_summary = $3, error_message = $4,
         metadata = $5::jsonb, ended_at = $6
     WHERE trace_id = $7 AND span_id = $8`,
    [
      result.status,
      durationMs,
      result.outputSummary || null,
      result.errorMessage || null,
      JSON.stringify(result.metadata || {}),
      endedAt,
      span.traceId,
      span.spanId,
    ],
  );
}

// ── Metrics ────────────────────────────────────────────────────────────────

export async function recordMetric(
  name: string,
  value: number,
  opts?: {
    type?: 'counter' | 'gauge' | 'histogram';
    labels?: Record<string, string>;
    agent?: string;
  },
): Promise<void> {
  await query(
    `INSERT INTO obs_metrics (metric_name, metric_type, value, labels, agent)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      name,
      opts?.type || 'counter',
      value,
      JSON.stringify(opts?.labels || {}),
      opts?.agent || null,
    ],
  );
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getTraces(opts: {
  traceId?: string;
  agent?: string;
  tool?: string;
  since?: string;
  limit?: number;
}): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (opts.traceId) {
    conditions.push(`trace_id = $${idx++}`);
    params.push(opts.traceId);
  }
  if (opts.agent) {
    conditions.push(`agent = $${idx++}`);
    params.push(opts.agent);
  }
  if (opts.tool) {
    conditions.push(`tool = $${idx++}`);
    params.push(opts.tool);
  }
  if (opts.since) {
    conditions.push(`started_at >= $${idx++}::timestamptz`);
    params.push(opts.since);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(opts.limit || 50);

  const result = await query(
    `SELECT * FROM obs_traces ${where} ORDER BY started_at DESC LIMIT $${idx}`,
    params,
  );
  return result.rows;
}

export async function getMetricsSummary(opts: {
  metricName?: string;
  agent?: string;
  since?: string;
  limit?: number;
}): Promise<any> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (opts.metricName) {
    conditions.push(`metric_name = $${idx++}`);
    params.push(opts.metricName);
  }
  if (opts.agent) {
    conditions.push(`agent = $${idx++}`);
    params.push(opts.agent);
  }
  if (opts.since) {
    conditions.push(`recorded_at >= $${idx++}::timestamptz`);
    params.push(opts.since);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const result = await query(
    `SELECT metric_name, metric_type, COUNT(*) as data_points,
            SUM(value) as total, AVG(value) as avg, MIN(value) as min, MAX(value) as max,
            MIN(recorded_at) as first_at, MAX(recorded_at) as last_at
     FROM obs_metrics
     ${where}
     GROUP BY metric_name, metric_type
     ORDER BY last_at DESC
     LIMIT $${idx}`,
    [...params, opts.limit || 50],
  );
  return { metrics: result.rows };
}

// ── Health Dashboard ───────────────────────────────────────────────────────

export async function getHealthDashboard(): Promise<Record<string, any>> {
  const [agentCards, traces24h, metrics24h, workflows] = await Promise.all([
    query(`SELECT agent_id, status, last_heartbeat FROM agent_cards ORDER BY agent_id`).catch(
      () => ({ rows: [] }),
    ),
    query(
      `SELECT status, COUNT(*) as count
       FROM obs_traces WHERE started_at > NOW() - INTERVAL '24 hours'
       GROUP BY status`,
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT metric_name, SUM(value) as total
       FROM obs_metrics WHERE recorded_at > NOW() - INTERVAL '24 hours'
       GROUP BY metric_name ORDER BY total DESC LIMIT 20`,
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT status, COUNT(*) as count FROM workflow_instances GROUP BY status`,
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    agents: {
      total: agentCards.rows.length,
      by_status: agentCards.rows.reduce(
        (acc: Record<string, number>, r: any) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        },
        {},
      ),
    },
    traces_24h: traces24h.rows,
    top_metrics_24h: metrics24h.rows,
    workflows: workflows.rows,
  };
}
