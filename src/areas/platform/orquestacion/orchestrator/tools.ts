/**
 * Orchestrator tools — workflows, task queue, and agent protocol.
 * 18 tools with prefix orch_
 */

import type { ToolDefinition } from '../../../../shared/types.js';
import {
  createWorkflowDefinition,
  startWorkflow,
  getWorkflowStatus,
  listWorkflowDefinitions,
  listWorkflowInstances,
  pauseWorkflow,
  resumeWorkflow,
  cancelWorkflow,
} from '../../../../services/workflow-engine.js';
import {
  enqueueTask,
  enqueueFlow,
  getTaskStatus,
  cancelTask,
  getQueueStats,
} from '../../../../services/task-queue.js';
import {
  listAgentCards,
  findAgentsByCapability,
  getAgentCard,
  sendMessage,
  respondToMessage,
  broadcastMessage,
  getInbox,
  getThread,
} from '../../../../services/agent-protocol.js';

export const tools: Record<string, ToolDefinition> = {
  // ── Workflows ──────────────────────────────────────────────────────────

  orch_workflow_create: {
    description:
      '[Orchestrator] Create or update a reusable workflow definition (DAG of steps). Steps can be tool_call, delegate, condition, event_wait, parallel_branch, or join. Use dependsOn to define execution order.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Unique workflow name' },
        description: { type: 'string', description: 'What this workflow does' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique step ID within workflow' },
              name: { type: 'string', description: 'Human-readable step name' },
              type: {
                type: 'string',
                enum: ['tool_call', 'delegate', 'condition', 'event_wait', 'parallel_branch', 'join'],
              },
              agent: { type: 'string', description: 'Target agent (for delegate/tool_call)' },
              tool: { type: 'string', description: 'Tool name to invoke' },
              params: { type: 'object', description: 'Tool parameters. Use $context.stepId.field for dynamic resolution' },
              dependsOn: {
                type: 'array',
                items: { type: 'string' },
                description: 'Step IDs that must complete before this step runs',
              },
              condition: { type: 'string', description: 'JS expression for condition type' },
              timeout_ms: { type: 'number' },
            },
            required: ['id', 'name', 'type'],
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              condition: { type: 'string' },
            },
            required: ['from', 'to'],
          },
        },
        metadata: { type: 'object' },
        created_by: { type: 'string' },
      },
      required: ['name', 'steps'],
    },
    handler: async (args: any) => createWorkflowDefinition(args),
  },

  orch_workflow_start: {
    description:
      '[Orchestrator] Start a workflow instance from a definition name. Provide input data that steps can reference via $context.',
    inputSchema: {
      type: 'object',
      properties: {
        definition_name: { type: 'string', description: 'Name of the workflow definition' },
        input: { type: 'object', description: 'Input data for the workflow' },
        started_by: { type: 'string', description: 'Who/what started this workflow' },
      },
      required: ['definition_name'],
    },
    handler: async (args: any) =>
      startWorkflow(args.definition_name, args.input || {}, {
        startedBy: args.started_by,
      }),
  },

  orch_workflow_status: {
    description:
      '[Orchestrator] Get the full status of a workflow instance including all step states, outputs, and errors.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'number', description: 'Workflow instance ID' },
      },
      required: ['instance_id'],
    },
    handler: async (args: any) => {
      const status = await getWorkflowStatus(args.instance_id);
      if (!status) return { error: 'Workflow instance not found' };
      return status;
    },
  },

  orch_workflow_list: {
    description:
      '[Orchestrator] List workflow definitions or instances. Use mode="definitions" for templates, mode="instances" for executions.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['definitions', 'instances'],
          description: 'What to list (default: definitions)',
        },
        status: { type: 'string', description: 'Filter instances by status' },
        definition_name: { type: 'string', description: 'Filter instances by definition name' },
        limit: { type: 'number' },
      },
    },
    handler: async (args: any) => {
      if (args.mode === 'instances') {
        return {
          instances: await listWorkflowInstances({
            status: args.status,
            definitionName: args.definition_name,
            limit: args.limit,
          }),
        };
      }
      return { definitions: await listWorkflowDefinitions({ limit: args.limit }) };
    },
  },

  orch_workflow_pause: {
    description: '[Orchestrator] Pause a running workflow instance.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'number' },
      },
      required: ['instance_id'],
    },
    handler: async (args: any) => ({
      success: await pauseWorkflow(args.instance_id),
    }),
  },

  orch_workflow_resume: {
    description: '[Orchestrator] Resume a paused workflow instance.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'number' },
      },
      required: ['instance_id'],
    },
    handler: async (args: any) => ({
      success: await resumeWorkflow(args.instance_id),
    }),
  },

  orch_workflow_cancel: {
    description: '[Orchestrator] Cancel a running or paused workflow instance.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'number' },
      },
      required: ['instance_id'],
    },
    handler: async (args: any) => ({
      success: await cancelWorkflow(args.instance_id),
    }),
  },

  // ── Task Queue ─────────────────────────────────────────────────────────

  orch_task_enqueue: {
    description:
      '[Orchestrator] Delegate a task to another agent via the BullMQ queue. The task will execute the specified tool with the given arguments. Returns a task ID for tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        from_agent: { type: 'string', description: 'ID of the requesting agent' },
        to_agent: { type: 'string', description: 'ID of the target agent' },
        tool: { type: 'string', description: 'Tool name to invoke' },
        args: { type: 'object', description: 'Tool arguments' },
        priority: {
          type: 'number',
          description: 'Priority 1-10 (1=highest, default 5)',
        },
        timeout: { type: 'number', description: 'Timeout in ms (default 60000)' },
      },
      required: ['from_agent', 'to_agent', 'tool'],
    },
    handler: async (args: any) =>
      enqueueTask({
        fromAgent: args.from_agent,
        toAgent: args.to_agent,
        tool: args.tool,
        args: args.args,
        priority: args.priority,
        timeout: args.timeout,
      }),
  },

  orch_task_flow: {
    description:
      '[Orchestrator] Create a DAG of dependent tasks. Children complete before their parent. Each step specifies a tool and target agent.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Flow name' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              tool: { type: 'string' },
              args: { type: 'object' },
              to_agent: { type: 'string' },
              children: {
                type: 'array',
                items: { type: 'string' },
                description: 'Step IDs that must complete before this step',
              },
            },
            required: ['id', 'tool', 'to_agent'],
          },
        },
      },
      required: ['name', 'steps'],
    },
    handler: async (args: any) =>
      enqueueFlow({
        name: args.name,
        steps: args.steps.map((s: any) => ({
          id: s.id,
          tool: s.tool,
          args: s.args,
          toAgent: s.to_agent,
          children: s.children,
        })),
      }),
  },

  orch_task_status: {
    description: '[Orchestrator] Check the status and result of a queued task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID returned by orch_task_enqueue' },
      },
      required: ['task_id'],
    },
    handler: async (args: any) => getTaskStatus(args.task_id),
  },

  orch_task_cancel: {
    description: '[Orchestrator] Cancel a pending or active task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
    },
    handler: async (args: any) => ({
      cancelled: await cancelTask(args.task_id),
    }),
  },

  orch_queue_stats: {
    description: '[Orchestrator] Get task queue statistics (waiting, active, completed, failed, delayed counts).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => getQueueStats(),
  },

  // ── Agent Protocol ─────────────────────────────────────────────────────

  orch_agent_cards: {
    description:
      '[Orchestrator] List all registered agent cards with their capabilities, tools, and status. Optionally filter by layer, area, or role.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['app', 'platform', 'strategy'] },
        area_id: { type: 'string' },
        role: { type: 'string', enum: ['lead', 'specialist'] },
      },
    },
    handler: async (args: any) => ({
      agents: await listAgentCards(args),
    }),
  },

  orch_agent_find: {
    description:
      '[Orchestrator] Find agents that have a specific capability (e.g. "workflow-management", "session-tracking", "browser-session").',
    inputSchema: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: 'Capability to search for' },
      },
      required: ['capability'],
    },
    handler: async (args: any) => ({
      agents: await findAgentsByCapability(args.capability),
    }),
  },

  orch_agent_send: {
    description:
      '[Orchestrator] Send a message to another agent. Creates a thread for tracking the conversation. The target agent can respond via orch_agent_respond.',
    inputSchema: {
      type: 'object',
      properties: {
        from_agent: { type: 'string' },
        to_agent: { type: 'string' },
        topic: { type: 'string', description: 'Message topic/subject' },
        payload: { type: 'object', description: 'Message content' },
        thread_id: { type: 'string', description: 'Existing thread ID to continue (optional)' },
        expires_in_minutes: { type: 'number', description: 'Auto-expire after N minutes' },
      },
      required: ['from_agent', 'to_agent', 'payload'],
    },
    handler: async (args: any) =>
      sendMessage({
        fromAgent: args.from_agent,
        toAgent: args.to_agent,
        topic: args.topic,
        payload: args.payload,
        threadId: args.thread_id,
        expiresInMinutes: args.expires_in_minutes,
      }),
  },

  orch_agent_respond: {
    description:
      '[Orchestrator] Respond to a received agent message. Updates the original message status and adds the response to the thread.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'number', description: 'ID of the message to respond to' },
        response: { type: 'object', description: 'Response payload' },
        responding_agent: { type: 'string', description: 'ID of the responding agent' },
      },
      required: ['message_id', 'response', 'responding_agent'],
    },
    handler: async (args: any) => {
      await respondToMessage(args.message_id, args.response, args.responding_agent);
      return { ok: true };
    },
  },

  orch_agent_broadcast: {
    description:
      '[Orchestrator] Broadcast a message to all agents by topic. No specific target — any interested agent can read it.',
    inputSchema: {
      type: 'object',
      properties: {
        from_agent: { type: 'string' },
        topic: { type: 'string', description: 'Broadcast topic' },
        payload: { type: 'object', description: 'Broadcast content' },
      },
      required: ['from_agent', 'topic', 'payload'],
    },
    handler: async (args: any) =>
      broadcastMessage({
        fromAgent: args.from_agent,
        topic: args.topic,
        payload: args.payload,
      }),
  },

  orch_agent_thread: {
    description:
      '[Orchestrator] Read all messages in a conversation thread between agents.',
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string' },
      },
      required: ['thread_id'],
    },
    handler: async (args: any) => ({
      messages: await getThread(args.thread_id),
    }),
  },

  orch_agent_inbox: {
    description:
      '[Orchestrator] Get pending messages for a specific agent. Shows messages that haven\'t been responded to yet.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent to check inbox for' },
        status: { type: 'string', description: 'Filter by status (default: all)' },
        limit: { type: 'number' },
      },
      required: ['agent_id'],
    },
    handler: async (args: any) => ({
      messages: await getInbox(args.agent_id, {
        status: args.status,
        limit: args.limit,
      }),
    }),
  },
};
