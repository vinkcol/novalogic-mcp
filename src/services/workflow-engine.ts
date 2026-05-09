/**
 * Workflow Engine — DAG-based multi-step workflow execution.
 *
 * Workflows are defined as directed acyclic graphs of steps.
 * Each step can be a tool_call, event_wait, delegate, condition,
 * parallel_branch, or join.
 *
 * State is persisted in PostgreSQL (workflow_definitions, workflow_instances,
 * workflow_step_executions) for durability and recovery.
 *
 * Parameter resolution: step params can reference prior step outputs using
 * `$context.stepId.fieldName` syntax.
 */

import { query } from '../db/client.js';
import { generateTraceId, startSpan, endSpan, recordMetric } from './observability.js';
import { enqueueTask } from './task-queue.js';
import { publishEvent } from './event-bus.js';
import type { ToolDefinition } from '../shared/types.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowStepDef {
  id: string;
  name: string;
  type: 'tool_call' | 'event_wait' | 'delegate' | 'condition' | 'parallel_branch' | 'join';
  agent?: string;
  tool?: string;
  params?: Record<string, unknown>;
  dependsOn?: string[];
  condition?: string;
  timeout_ms?: number;
  retries?: number;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

// ── Definitions CRUD ───────────────────────────────────────────────────────

export async function createWorkflowDefinition(def: {
  name: string;
  description?: string;
  steps: WorkflowStepDef[];
  edges?: WorkflowEdge[];
  metadata?: Record<string, unknown>;
  createdBy?: string;
}): Promise<{ id: number; name: string }> {
  // Validate DAG
  const stepIds = new Set(def.steps.map((s) => s.id));
  for (const step of def.steps) {
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
        }
      }
    }
  }

  // Check for cycles
  detectCycles(def.steps);

  const result = await query(
    `INSERT INTO workflow_definitions (name, description, steps, edges, metadata, created_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (name) DO UPDATE SET
       description = EXCLUDED.description,
       steps = EXCLUDED.steps,
       edges = EXCLUDED.edges,
       metadata = EXCLUDED.metadata,
       version = workflow_definitions.version + 1,
       updated_at = NOW()
     RETURNING id, name, version`,
    [
      def.name,
      def.description || null,
      JSON.stringify(def.steps),
      JSON.stringify(def.edges || []),
      JSON.stringify(def.metadata || {}),
      def.createdBy || null,
    ],
  );

  return { id: result.rows[0].id, name: result.rows[0].name };
}

export async function getWorkflowDefinition(
  nameOrId: string | number,
): Promise<any | null> {
  const isId = typeof nameOrId === 'number';
  const result = await query(
    `SELECT * FROM workflow_definitions WHERE ${isId ? 'id = $1' : 'name = $1'}`,
    [nameOrId],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function listWorkflowDefinitions(opts?: {
  activeOnly?: boolean;
  limit?: number;
}): Promise<any[]> {
  const where = opts?.activeOnly !== false ? 'WHERE is_active = true' : '';
  const result = await query(
    `SELECT id, name, description, version, is_active,
            jsonb_array_length(steps) as step_count,
            created_by, created_at, updated_at
     FROM workflow_definitions
     ${where}
     ORDER BY updated_at DESC
     LIMIT $1`,
    [opts?.limit || 50],
  );
  return result.rows;
}

// ── Workflow Execution ─────────────────────────────────────────────────────

export async function startWorkflow(
  definitionName: string,
  input: Record<string, unknown>,
  opts?: { startedBy?: string; traceId?: string },
): Promise<{ instanceId: number; traceId: string }> {
  const def = await getWorkflowDefinition(definitionName);
  if (!def) throw new Error(`Workflow definition not found: ${definitionName}`);
  if (!def.is_active) throw new Error(`Workflow "${definitionName}" is not active`);

  const traceId = opts?.traceId || generateTraceId();
  const steps: WorkflowStepDef[] = def.steps;

  // Create instance
  const instResult = await query(
    `INSERT INTO workflow_instances (definition_id, definition_name, status, input, context, trace_id, started_by, started_at)
     VALUES ($1, $2, 'running', $3::jsonb, '{}'::jsonb, $4, $5, NOW())
     RETURNING id`,
    [def.id, def.name, JSON.stringify(input), traceId, opts?.startedBy || null],
  );
  const instanceId = instResult.rows[0].id;

  // Create step execution rows
  for (const step of steps) {
    await query(
      `INSERT INTO workflow_step_executions (instance_id, step_id, step_name, step_type)
       VALUES ($1, $2, $3, $4)`,
      [instanceId, step.id, step.name, step.type],
    );
  }

  publishEvent({
    type: 'workflow.started',
    source: 'workflow-engine',
    traceId,
    payload: { instanceId, definitionName, stepCount: steps.length },
  }).catch(() => {});

  recordMetric('workflows.started', 1, {
    labels: { definition: definitionName },
  }).catch(() => {});

  // Execute root steps (those with no dependsOn)
  await advanceWorkflow(instanceId, steps, null);

  return { instanceId, traceId };
}

async function advanceWorkflow(
  instanceId: number,
  stepDefs: WorkflowStepDef[],
  allTools: Record<string, ToolDefinition> | null,
): Promise<void> {
  // Get current step states
  const stepsResult = await query(
    `SELECT step_id, status FROM workflow_step_executions WHERE instance_id = $1`,
    [instanceId],
  );
  const stepStates = new Map<string, string>();
  for (const row of stepsResult.rows) {
    stepStates.set(row.step_id, row.status);
  }

  // Get instance context
  const instResult = await query(
    `SELECT context, input, trace_id FROM workflow_instances WHERE id = $1`,
    [instanceId],
  );
  if (instResult.rows.length === 0) return;
  const { context, input, trace_id: traceId } = instResult.rows[0];

  // Find steps ready to execute
  for (const step of stepDefs) {
    const currentStatus = stepStates.get(step.id);
    if (currentStatus !== 'pending') continue;

    // Check all dependencies are completed
    const deps = step.dependsOn || [];
    const allDepsCompleted = deps.every((d) => stepStates.get(d) === 'completed');
    if (!allDepsCompleted) continue;

    // Execute the step
    await executeStep(instanceId, step, { ...input, ...context }, traceId, allTools);
  }

  // Check if all steps are done
  const updatedSteps = await query(
    `SELECT step_id, status FROM workflow_step_executions WHERE instance_id = $1`,
    [instanceId],
  );
  const statuses = updatedSteps.rows.map((r: any) => r.status);

  if (statuses.every((s: string) => s === 'completed' || s === 'skipped')) {
    await query(
      `UPDATE workflow_instances SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [instanceId],
    );
    publishEvent({
      type: 'workflow.completed',
      source: 'workflow-engine',
      traceId,
      payload: { instanceId },
    }).catch(() => {});
    recordMetric('workflows.completed', 1).catch(() => {});
  } else if (statuses.some((s: string) => s === 'failed')) {
    await query(
      `UPDATE workflow_instances SET status = 'failed', updated_at = NOW(),
       error_message = 'One or more steps failed'
       WHERE id = $1`,
      [instanceId],
    );
    recordMetric('workflows.failed', 1).catch(() => {});
  }
}

async function executeStep(
  instanceId: number,
  step: WorkflowStepDef,
  resolvedContext: Record<string, unknown>,
  traceId: string,
  allTools: Record<string, ToolDefinition> | null,
): Promise<void> {
  // Mark as running
  await query(
    `UPDATE workflow_step_executions SET status = 'running', started_at = NOW(), attempts = attempts + 1
     WHERE instance_id = $1 AND step_id = $2`,
    [instanceId, step.id],
  );

  const span = await startSpan({
    traceId,
    operation: `workflow:step:${step.id}`,
    agent: step.agent,
    tool: step.tool,
  });

  try {
    let result: unknown = null;

    switch (step.type) {
      case 'tool_call': {
        if (!step.tool) throw new Error(`Step "${step.id}" is tool_call but has no tool`);
        // Resolve params from context
        const resolvedParams = resolveParams(step.params || {}, resolvedContext);

        if (allTools && allTools[step.tool]) {
          result = await allTools[step.tool].handler(resolvedParams);
        } else {
          // Delegate via task queue
          const task = await enqueueTask({
            fromAgent: 'workflow-engine',
            toAgent: step.agent || 'orchestrator',
            tool: step.tool,
            args: resolvedParams,
            traceId,
          });
          result = { delegated: true, taskId: task.taskId };
        }
        break;
      }

      case 'delegate': {
        if (!step.tool || !step.agent) {
          throw new Error(`Step "${step.id}" is delegate but missing tool or agent`);
        }
        const resolvedParams = resolveParams(step.params || {}, resolvedContext);
        const task = await enqueueTask({
          fromAgent: 'workflow-engine',
          toAgent: step.agent,
          tool: step.tool,
          args: resolvedParams,
          traceId,
        });
        result = { delegated: true, taskId: task.taskId };
        break;
      }

      case 'condition': {
        if (!step.condition) throw new Error(`Step "${step.id}" is condition but has no condition`);
        const condResult = evaluateCondition(step.condition, resolvedContext);
        result = { conditionMet: condResult };
        break;
      }

      case 'event_wait': {
        // Mark as waiting — external event will resume
        await query(
          `UPDATE workflow_step_executions SET status = 'waiting'
           WHERE instance_id = $1 AND step_id = $2`,
          [instanceId, step.id],
        );
        await endSpan(span, { status: 'ok', outputSummary: 'waiting for event' });
        return; // Don't mark completed
      }

      case 'parallel_branch':
      case 'join':
        // These are structural — mark as completed immediately
        result = { type: step.type };
        break;
    }

    // Mark step completed and store result in context
    await query(
      `UPDATE workflow_step_executions SET status = 'completed', output = $1::jsonb, completed_at = NOW()
       WHERE instance_id = $2 AND step_id = $3`,
      [JSON.stringify(result), instanceId, step.id],
    );

    // Update instance context with step result
    await query(
      `UPDATE workflow_instances SET context = context || $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ [step.id]: result }), instanceId],
    );

    await endSpan(span, {
      status: 'ok',
      outputSummary: JSON.stringify(result).slice(0, 200),
    });
  } catch (err: any) {
    await query(
      `UPDATE workflow_step_executions SET status = 'failed', error_message = $1, completed_at = NOW()
       WHERE instance_id = $2 AND step_id = $3`,
      [err.message, instanceId, step.id],
    );

    await endSpan(span, { status: 'error', errorMessage: err.message });
  }
}

// ── Workflow Queries ───────────────────────────────────────────────────────

export async function getWorkflowStatus(instanceId: number): Promise<any> {
  const instResult = await query(
    `SELECT * FROM workflow_instances WHERE id = $1`,
    [instanceId],
  );
  if (instResult.rows.length === 0) return null;

  const stepsResult = await query(
    `SELECT step_id, step_name, step_type, status, input, output, error_message, attempts, started_at, completed_at
     FROM workflow_step_executions
     WHERE instance_id = $1
     ORDER BY created_at`,
    [instanceId],
  );

  return {
    instance: instResult.rows[0],
    steps: stepsResult.rows,
  };
}

export async function listWorkflowInstances(opts?: {
  status?: string;
  definitionName?: string;
  limit?: number;
}): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (opts?.status) {
    conditions.push(`status = $${idx++}::workflow_status`);
    params.push(opts.status);
  }
  if (opts?.definitionName) {
    conditions.push(`definition_name = $${idx++}`);
    params.push(opts.definitionName);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(opts?.limit || 50);

  const result = await query(
    `SELECT id, definition_name, status, trace_id, started_by, error_message,
            started_at, completed_at, created_at
     FROM workflow_instances
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );

  return result.rows;
}

// ── Workflow Control ───────────────────────────────────────────────────────

export async function pauseWorkflow(instanceId: number): Promise<boolean> {
  const result = await query(
    `UPDATE workflow_instances SET status = 'paused', updated_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING id`,
    [instanceId],
  );
  return result.rows.length > 0;
}

export async function resumeWorkflow(instanceId: number): Promise<boolean> {
  const result = await query(
    `UPDATE workflow_instances SET status = 'running', updated_at = NOW()
     WHERE id = $1 AND status = 'paused'
     RETURNING id`,
    [instanceId],
  );
  if (result.rows.length === 0) return false;

  // Re-fetch definition and re-advance
  const inst = await query(
    `SELECT wi.definition_id, wd.steps
     FROM workflow_instances wi
     JOIN workflow_definitions wd ON wi.definition_id = wd.id
     WHERE wi.id = $1`,
    [instanceId],
  );
  if (inst.rows.length > 0) {
    await advanceWorkflow(instanceId, inst.rows[0].steps, null);
  }
  return true;
}

export async function cancelWorkflow(instanceId: number): Promise<boolean> {
  const result = await query(
    `UPDATE workflow_instances SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('running', 'paused', 'pending')
     RETURNING id`,
    [instanceId],
  );
  if (result.rows.length > 0) {
    // Cancel all pending steps
    await query(
      `UPDATE workflow_step_executions SET status = 'skipped'
       WHERE instance_id = $1 AND status IN ('pending', 'waiting')`,
      [instanceId],
    );
    return true;
  }
  return false;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveParams(
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.startsWith('$context.')) {
      const path = value.slice(9).split('.');
      let current: any = context;
      for (const segment of path) {
        if (current == null) break;
        current = current[segment];
      }
      resolved[key] = current;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      resolved[key] = resolveParams(value as Record<string, unknown>, context);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

function evaluateCondition(
  condition: string,
  context: Record<string, unknown>,
): boolean {
  // Simple expression evaluator: supports $context.stepId.field == "value"
  // Security: only allows comparison operators, no arbitrary code
  const resolved = condition.replace(
    /\$context\.([a-zA-Z0-9_.]+)/g,
    (_match, path: string) => {
      const segments = path.split('.');
      let current: any = context;
      for (const seg of segments) {
        if (current == null) return 'null';
        current = current[seg];
      }
      return JSON.stringify(current);
    },
  );

  // Only allow safe comparisons
  const safePattern = /^[\s"'\w\d\-_.{}[\]:,]+(===?|!==?|>=?|<=?|&&|\|\|)[\s"'\w\d\-_.{}[\]:,]+$/;
  if (!safePattern.test(resolved)) {
    throw new Error(`Unsafe condition expression: ${condition}`);
  }

  try {
    return new Function(`"use strict"; return (${resolved});`)() as boolean;
  } catch {
    return false;
  }
}

function detectCycles(steps: WorkflowStepDef[]): void {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adj = new Map<string, string[]>();

  for (const step of steps) {
    adj.set(step.id, []);
  }
  for (const step of steps) {
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        const edges = adj.get(dep);
        if (edges) edges.push(step.id);
      }
    }
  }

  function dfs(node: string): void {
    visited.add(node);
    inStack.add(node);
    for (const neighbor of adj.get(node) || []) {
      if (inStack.has(neighbor)) {
        throw new Error(`Cycle detected: ${node} → ${neighbor}`);
      }
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      }
    }
    inStack.delete(node);
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id);
    }
  }
}
