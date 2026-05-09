/**
 * Task Queue — BullMQ-based agent-to-agent task delegation.
 *
 * Provides a single shared queue where agents can delegate tool invocations
 * to other agents. Workers process tasks by looking up the target tool in
 * the global tool registry and executing it.
 *
 * Features:
 * - Priority-based execution (1 highest, 10 lowest)
 * - Automatic retries with exponential backoff
 * - DAG job dependencies via FlowProducer
 * - Job progress tracking and result retrieval
 */

import { Queue, Worker, FlowProducer, Job } from 'bullmq';
import type { FlowJob } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { getRedisConfig } from './redis-client.js';
import { publishEvent } from './event-bus.js';
import { generateTraceId, startSpan, endSpan, recordMetric } from './observability.js';
import type { ToolDefinition } from '../shared/types.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskPayload {
  taskId: string;
  fromAgent: string;
  toAgent: string;
  tool: string;
  args: Record<string, unknown>;
  traceId: string;
  priority?: number;
  timeout?: number;
}

export interface TaskResult {
  taskId: string;
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
  duration_ms: number;
}

// ── State ──────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'nova-tasks';

let queue: Queue | null = null;
let worker: Worker | null = null;
let flowProducer: FlowProducer | null = null;
let toolRegistry: Record<string, ToolDefinition> = {};

// ── Initialization ─────────────────────────────────────────────────────────

export async function initTaskQueue(
  allTools: Record<string, ToolDefinition>,
): Promise<void> {
  toolRegistry = allTools;
  const connection = getRedisConfig();

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  });

  flowProducer = new FlowProducer({ connection });

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<TaskPayload>) => {
      const { tool, args, traceId, fromAgent, toAgent } = job.data;

      const toolDef = toolRegistry[tool];
      if (!toolDef) {
        throw new Error(`Tool not found in registry: ${tool}`);
      }

      const span = await startSpan({
        traceId,
        operation: `task:${tool}`,
        agent: toAgent,
        tool,
        inputSummary: JSON.stringify(args).slice(0, 200),
      });

      try {
        const result = await toolDef.handler(args);

        await endSpan(span, {
          status: 'ok',
          outputSummary: JSON.stringify(result).slice(0, 200),
        });

        await job.updateProgress(100);

        publishEvent({
          type: 'task.completed',
          source: toAgent,
          traceId,
          payload: {
            taskId: job.data.taskId,
            tool,
            fromAgent,
            toAgent,
          },
        }).catch(() => {});

        recordMetric('tasks.completed', 1, {
          labels: { tool, agent: toAgent },
        }).catch(() => {});

        return result;
      } catch (err: any) {
        await endSpan(span, {
          status: 'error',
          errorMessage: err.message,
        });

        publishEvent({
          type: 'task.failed',
          source: toAgent,
          traceId,
          payload: {
            taskId: job.data.taskId,
            tool,
            error: err.message,
            attempt: job.attemptsMade + 1,
          },
        }).catch(() => {});

        recordMetric('tasks.failed', 1, {
          labels: { tool, agent: toAgent },
        }).catch(() => {});

        throw err;
      }
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 20, duration: 1000 },
    },
  );

  worker.on('error', (err) => {
    process.stderr.write(`[task-queue] Worker error: ${err.message}\n`);
  });
}

// ── Enqueue Single Task ────────────────────────────────────────────────────

export async function enqueueTask(opts: {
  fromAgent: string;
  toAgent: string;
  tool: string;
  args?: Record<string, unknown>;
  traceId?: string;
  priority?: number;
  timeout?: number;
}): Promise<{ taskId: string; jobId: string }> {
  if (!queue) throw new Error('Task queue not initialized');

  const taskId = 'task_' + randomUUID().replace(/-/g, '').slice(0, 16);
  const traceId = opts.traceId || generateTraceId();

  const payload: TaskPayload = {
    taskId,
    fromAgent: opts.fromAgent,
    toAgent: opts.toAgent,
    tool: opts.tool,
    args: opts.args || {},
    traceId,
    priority: opts.priority,
    timeout: opts.timeout,
  };

  const job = await queue.add(opts.tool, payload, {
    jobId: taskId,
    priority: opts.priority || 5,
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
  });

  recordMetric('tasks.enqueued', 1, {
    labels: { tool: opts.tool, from: opts.fromAgent, to: opts.toAgent },
  }).catch(() => {});

  return { taskId, jobId: job.id! };
}

// ── Enqueue DAG Flow ───────────────────────────────────────────────────────

export async function enqueueFlow(opts: {
  name: string;
  traceId?: string;
  steps: Array<{
    id: string;
    tool: string;
    args?: Record<string, unknown>;
    toAgent: string;
    children?: string[];
  }>;
}): Promise<{ flowId: string; traceId: string }> {
  if (!flowProducer) throw new Error('Task queue not initialized');

  const traceId = opts.traceId || generateTraceId();

  // Build BullMQ flow tree (children must complete before parent)
  // Find root step (no other step lists it as a child)
  const childIds = new Set(opts.steps.flatMap((s) => s.children || []));
  const roots = opts.steps.filter((s) => !childIds.has(s.id));

  if (roots.length === 0) {
    throw new Error('Flow has no root step (circular dependency?)');
  }

  function buildFlowJob(stepId: string): FlowJob {
    const step = opts.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    const taskId = 'task_' + randomUUID().replace(/-/g, '').slice(0, 16);
    const payload: TaskPayload = {
      taskId,
      fromAgent: 'orchestrator',
      toAgent: step.toAgent,
      tool: step.tool,
      args: step.args || {},
      traceId,
    };

    const childJobs = (step.children || []).map((childId) => buildFlowJob(childId));

    return {
      name: step.tool,
      queueName: QUEUE_NAME,
      data: payload,
      opts: { jobId: taskId },
      children: childJobs.length > 0 ? childJobs : undefined,
    };
  }

  // For multiple roots, wrap them under a virtual root
  let rootJob: FlowJob;
  if (roots.length === 1) {
    rootJob = buildFlowJob(roots[0].id);
  } else {
    rootJob = {
      name: 'flow:' + opts.name,
      queueName: QUEUE_NAME,
      data: {
        taskId: 'flow_' + randomUUID().replace(/-/g, '').slice(0, 16),
        fromAgent: 'orchestrator',
        toAgent: 'orchestrator',
        tool: '__flow_root__',
        args: {},
        traceId,
      },
      children: roots.map((r) => buildFlowJob(r.id)),
    };
  }

  const flow = await flowProducer.add(rootJob);

  return { flowId: flow.job.id!, traceId };
}

// ── Task Status ────────────────────────────────────────────────────────────

export async function getTaskStatus(
  taskId: string,
): Promise<{
  taskId: string;
  status: string;
  progress?: number;
  result?: unknown;
  error?: string;
  attempts?: number;
}> {
  if (!queue) throw new Error('Task queue not initialized');

  const job = await Job.fromId(queue, taskId);
  if (!job) {
    return { taskId, status: 'not_found' };
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    taskId,
    status: state,
    progress: typeof progress === 'number' ? progress : undefined,
    result: state === 'completed' ? job.returnvalue : undefined,
    error: state === 'failed' ? job.failedReason : undefined,
    attempts: job.attemptsMade,
  };
}

// ── Cancel Task ────────────────────────────────────────────────────────────

export async function cancelTask(taskId: string): Promise<boolean> {
  if (!queue) throw new Error('Task queue not initialized');

  const job = await Job.fromId(queue, taskId);
  if (!job) return false;

  const state = await job.getState();
  if (state === 'active') {
    await job.moveToFailed(new Error('Cancelled by user'), 'cancelled');
    return true;
  }
  if (state === 'waiting' || state === 'delayed') {
    await job.remove();
    return true;
  }
  return false;
}

// ── Queue Stats ────────────────────────────────────────────────────────────

export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  if (!queue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }

  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  );

  return counts as any;
}

// ── Shutdown ───────────────────────────────────────────────────────────────

export async function shutdownTaskQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (flowProducer) {
    await flowProducer.close();
    flowProducer = null;
  }
}
