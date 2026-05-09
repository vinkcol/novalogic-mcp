/**
 * Agent Protocol — capability advertisement, messaging, and discovery.
 *
 * Agent Cards are auto-registered from the area/agent registry at startup.
 * Messages support request/response, broadcast, and notification patterns
 * with thread-based conversation tracking.
 */

import { randomUUID } from 'node:crypto';
import { query } from '../db/client.js';
import { publishEvent } from './event-bus.js';
import type { LoadedArea } from '../shared/types.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentCard {
  agentId: string;
  name: string;
  description: string;
  layer: string;
  areaId: string;
  role: string;
  capabilities: string[];
  toolNames: string[];
  acceptsTasks: boolean;
  maxConcurrent: number;
  status: string;
  lastHeartbeat?: Date;
}

export interface AgentMessage {
  id?: number;
  threadId: string;
  correlationId?: string;
  msgType: 'request' | 'response' | 'broadcast' | 'notification';
  fromAgent: string;
  toAgent?: string;
  topic?: string;
  payload: Record<string, unknown>;
  status?: string;
  response?: Record<string, unknown>;
  traceId?: string;
  expiresAt?: string;
  createdAt?: Date;
}

// ── Agent Card Registration ────────────────────────────────────────────────

export async function registerAgentCards(
  areas: Record<string, LoadedArea>,
): Promise<number> {
  let count = 0;

  for (const area of Object.values(areas)) {
    for (const agent of Object.values(area.agents)) {
      const { config, tools } = agent;
      const toolNames = Object.keys(tools);

      await query(
        `INSERT INTO agent_cards (agent_id, name, description, layer, area_id, role, capabilities, tool_names, accepts_tasks, last_heartbeat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
         ON CONFLICT (agent_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           layer = EXCLUDED.layer,
           area_id = EXCLUDED.area_id,
           role = EXCLUDED.role,
           capabilities = EXCLUDED.capabilities,
           tool_names = EXCLUDED.tool_names,
           last_heartbeat = NOW(),
           updated_at = NOW()`,
        [
          config.id,
          config.name,
          config.description,
          area.config.layer,
          config.areaId,
          config.role,
          config.capabilities,
          toolNames,
        ],
      );
      count++;
    }
  }

  return count;
}

// ── Agent Card Queries ─────────────────────────────────────────────────────

export async function listAgentCards(opts?: {
  layer?: string;
  areaId?: string;
  role?: string;
  status?: string;
}): Promise<AgentCard[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (opts?.layer) {
    conditions.push(`layer = $${idx++}`);
    params.push(opts.layer);
  }
  if (opts?.areaId) {
    conditions.push(`area_id = $${idx++}`);
    params.push(opts.areaId);
  }
  if (opts?.role) {
    conditions.push(`role = $${idx++}`);
    params.push(opts.role);
  }
  if (opts?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const result = await query(
    `SELECT agent_id, name, description, layer, area_id, role, capabilities,
            tool_names, accepts_tasks, max_concurrent, status, last_heartbeat
     FROM agent_cards ${where}
     ORDER BY layer, area_id, role DESC, agent_id`,
    params,
  );

  return result.rows.map(formatCard);
}

export async function getAgentCard(agentId: string): Promise<AgentCard | null> {
  const result = await query(
    `SELECT * FROM agent_cards WHERE agent_id = $1`,
    [agentId],
  );
  return result.rows.length > 0 ? formatCard(result.rows[0]) : null;
}

export async function findAgentsByCapability(
  capability: string,
): Promise<AgentCard[]> {
  const result = await query(
    `SELECT * FROM agent_cards WHERE $1 = ANY(capabilities) AND status = 'active'
     ORDER BY layer, area_id`,
    [capability],
  );
  return result.rows.map(formatCard);
}

function formatCard(row: any): AgentCard {
  return {
    agentId: row.agent_id,
    name: row.name,
    description: row.description,
    layer: row.layer,
    areaId: row.area_id,
    role: row.role,
    capabilities: row.capabilities || [],
    toolNames: row.tool_names || [],
    acceptsTasks: row.accepts_tasks,
    maxConcurrent: row.max_concurrent,
    status: row.status,
    lastHeartbeat: row.last_heartbeat,
  };
}

// ── Messaging ──────────────────────────────────────────────────────────────

export async function sendMessage(msg: {
  fromAgent: string;
  toAgent: string;
  topic?: string;
  payload: Record<string, unknown>;
  traceId?: string;
  threadId?: string;
  expiresInMinutes?: number;
}): Promise<{ messageId: number; threadId: string }> {
  const threadId = msg.threadId || 'thread_' + randomUUID().replace(/-/g, '').slice(0, 16);
  const expiresAt = msg.expiresInMinutes
    ? new Date(Date.now() + msg.expiresInMinutes * 60_000).toISOString()
    : null;

  const result = await query(
    `INSERT INTO agent_messages (thread_id, msg_type, from_agent, to_agent, topic, payload, trace_id, expires_at)
     VALUES ($1, 'request', $2, $3, $4, $5::jsonb, $6, $7::timestamptz)
     RETURNING id`,
    [
      threadId,
      msg.fromAgent,
      msg.toAgent,
      msg.topic || null,
      JSON.stringify(msg.payload),
      msg.traceId || null,
      expiresAt,
    ],
  );

  publishEvent({
    type: 'agent.message.sent',
    source: msg.fromAgent,
    traceId: msg.traceId,
    payload: {
      messageId: result.rows[0].id,
      threadId,
      toAgent: msg.toAgent,
      topic: msg.topic,
    },
  }).catch(() => {});

  return { messageId: result.rows[0].id, threadId };
}

export async function respondToMessage(
  messageId: number,
  response: Record<string, unknown>,
  respondingAgent: string,
): Promise<void> {
  // Update original message
  await query(
    `UPDATE agent_messages SET status = 'completed', response = $1::jsonb, responded_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(response), messageId],
  );

  // Get original message for thread context
  const original = await query(
    `SELECT thread_id, from_agent, trace_id FROM agent_messages WHERE id = $1`,
    [messageId],
  );

  if (original.rows.length > 0) {
    const { thread_id, from_agent, trace_id } = original.rows[0];

    // Insert response as a new message in the thread
    await query(
      `INSERT INTO agent_messages (thread_id, correlation_id, msg_type, from_agent, to_agent, topic, payload, status, trace_id)
       VALUES ($1, $2, 'response', $3, $4, NULL, $5::jsonb, 'completed', $6)`,
      [
        thread_id,
        String(messageId),
        respondingAgent,
        from_agent,
        JSON.stringify(response),
        trace_id,
      ],
    );
  }
}

export async function broadcastMessage(opts: {
  fromAgent: string;
  topic: string;
  payload: Record<string, unknown>;
  traceId?: string;
}): Promise<{ messageId: number; threadId: string }> {
  const threadId = 'bcast_' + randomUUID().replace(/-/g, '').slice(0, 16);

  const result = await query(
    `INSERT INTO agent_messages (thread_id, msg_type, from_agent, to_agent, topic, payload, status, trace_id)
     VALUES ($1, 'broadcast', $2, NULL, $3, $4::jsonb, 'delivered', $5)
     RETURNING id`,
    [
      threadId,
      opts.fromAgent,
      opts.topic,
      JSON.stringify(opts.payload),
      opts.traceId || null,
    ],
  );

  publishEvent({
    type: 'agent.broadcast',
    source: opts.fromAgent,
    traceId: opts.traceId,
    payload: {
      messageId: result.rows[0].id,
      topic: opts.topic,
    },
  }).catch(() => {});

  return { messageId: result.rows[0].id, threadId };
}

// ── Message Queries ────────────────────────────────────────────────────────

export async function getInbox(
  agentId: string,
  opts?: { status?: string; limit?: number },
): Promise<any[]> {
  const conditions = [`to_agent = $1`];
  const params: any[] = [agentId];
  let idx = 2;

  if (opts?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  }

  params.push(opts?.limit || 20);

  const result = await query(
    `SELECT id, thread_id, msg_type, from_agent, to_agent, topic, payload, status, response, trace_id, created_at
     FROM agent_messages
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params,
  );

  return result.rows;
}

export async function getThread(threadId: string): Promise<any[]> {
  const result = await query(
    `SELECT id, thread_id, correlation_id, msg_type, from_agent, to_agent, topic, payload, status, response, trace_id, created_at, responded_at
     FROM agent_messages
     WHERE thread_id = $1
     ORDER BY created_at ASC`,
    [threadId],
  );
  return result.rows;
}
