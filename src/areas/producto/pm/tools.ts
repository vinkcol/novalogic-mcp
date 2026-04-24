import { query } from '../../../db/client.js';
import { api } from '../../../services/api-client.js';

export const tools = {
  pm_create_task: {
    description: `[PM Agent] Create a new task in the project backlog. Use for features, bugs, tech debt, improvements, spikes, or epics. Assigns domain, priority, story points, and acceptance criteria.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Detailed description' },
        type: {
          type: 'string',
          enum: [
            'feature',
            'bug',
            'tech_debt',
            'improvement',
            'spike',
            'epic',
          ],
          description: 'Task type (default: feature)',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Priority level (default: medium)',
        },
        domain: {
          type: 'string',
          description:
            'Domain module (e.g., shipping, pos, inventory)',
        },
        assigned_agent: {
          type: 'string',
          enum: ['backend', 'frontend', 'architect', 'qa', 'librarian'],
          description: 'Agent to assign',
        },
        story_points: {
          type: 'number',
          description: 'Story point estimate (1, 2, 3, 5, 8, 13)',
        },
        sprint_id: {
          type: 'number',
          description: 'Sprint to assign to',
        },
        parent_id: {
          type: 'number',
          description: 'Parent task ID (for subtasks)',
        },
        acceptance_criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of acceptance criteria',
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
    handler: async (args: any) => {
      const result = await query(
        `INSERT INTO tasks (title, description, type, priority, domain, assigned_agent, story_points, sprint_id, parent_id, acceptance_criteria, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, status`,
        [
          args.title,
          args.description,
          args.type || 'feature',
          args.priority || 'medium',
          args.domain,
          args.assigned_agent,
          args.story_points,
          args.sprint_id,
          args.parent_id,
          JSON.stringify(args.acceptance_criteria || []),
          args.tags || [],
        ],
      );
      return {
        success: true,
        task: result.rows[0],
        message: `Task created: ${args.title}`,
      };
    },
  },

  pm_list_tasks: {
    description: `[PM Agent] List tasks with filters. View backlog, sprint items, or filtered task lists.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: [
            'backlog',
            'todo',
            'in_progress',
            'in_review',
            'done',
            'blocked',
            'cancelled',
          ],
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
        },
        domain: { type: 'string' },
        assigned_agent: { type: 'string' },
        sprint_id: { type: 'number' },
        type: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: async (args: any) => {
      let sql =
        'SELECT t.*, s.name as sprint_name FROM tasks t LEFT JOIN sprints s ON t.sprint_id = s.id WHERE 1=1';
      const params: any[] = [];
      let idx = 1;

      if (args.status) {
        sql += ` AND t.status = $${idx++}`;
        params.push(args.status);
      }
      if (args.priority) {
        sql += ` AND t.priority = $${idx++}`;
        params.push(args.priority);
      }
      if (args.domain) {
        sql += ` AND t.domain = $${idx++}`;
        params.push(args.domain);
      }
      if (args.assigned_agent) {
        sql += ` AND t.assigned_agent = $${idx++}`;
        params.push(args.assigned_agent);
      }
      if (args.sprint_id) {
        sql += ` AND t.sprint_id = $${idx++}`;
        params.push(args.sprint_id);
      }
      if (args.type) {
        sql += ` AND t.type = $${idx++}`;
        params.push(args.type);
      }

      sql += ` ORDER BY
        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        t.created_at DESC`;
      sql += ` LIMIT $${idx}`;
      params.push(args.limit || 50);

      const result = await query(sql, params);
      return { tasks: result.rows, count: result.rows.length };
    },
  },

  pm_update_task: {
    description: `[PM Agent] Update a task's status, priority, assignment, or other fields.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Task ID' },
        status: {
          type: 'string',
          enum: [
            'backlog',
            'todo',
            'in_progress',
            'in_review',
            'done',
            'blocked',
            'cancelled',
          ],
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
        },
        assigned_agent: { type: 'string' },
        sprint_id: { type: 'number' },
        story_points: { type: 'number' },
        description: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const { id, ...updates } = args;
      const sets: string[] = ['updated_at = NOW()'];
      const params: any[] = [];
      let idx = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          sets.push(`${key} = $${idx++}`);
          params.push(value);
        }
      }

      params.push(id);
      const result = await query(
        `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params,
      );

      return result.rows.length > 0
        ? { success: true, task: result.rows[0] }
        : { error: `Task ${id} not found` };
    },
  },

  pm_create_sprint: {
    description: `[PM Agent] Create a new sprint with a name, goal, and date range.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description:
            'Sprint name (e.g., "Sprint 1 - Shipping MVP")',
        },
        goal: { type: 'string', description: 'Sprint goal' },
        start_date: {
          type: 'string',
          description: 'Start date (YYYY-MM-DD)',
        },
        end_date: {
          type: 'string',
          description: 'End date (YYYY-MM-DD)',
        },
      },
      required: ['name'],
    },
    handler: async (args: any) => {
      const result = await query(
        `INSERT INTO sprints (name, goal, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *`,
        [args.name, args.goal, args.start_date, args.end_date],
      );
      return { success: true, sprint: result.rows[0] };
    },
  },

  pm_get_sprint: {
    description: `[PM Agent] Get sprint details including all tasks, progress metrics, and burndown data.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sprint_id: {
          type: 'number',
          description: 'Sprint ID (latest if omitted)',
        },
      },
    },
    handler: async (args: any) => {
      let sprint;
      if (args.sprint_id) {
        const r = await query('SELECT * FROM sprints WHERE id = $1', [
          args.sprint_id,
        ]);
        sprint = r.rows[0];
      } else {
        const r = await query(
          'SELECT * FROM sprints ORDER BY created_at DESC LIMIT 1',
        );
        sprint = r.rows[0];
      }

      if (!sprint) return { error: 'No sprint found' };

      const tasks = await query(
        'SELECT * FROM tasks WHERE sprint_id = $1 ORDER BY priority, created_at',
        [sprint.id],
      );

      const statusCounts: Record<string, number> = {};
      let totalPoints = 0;
      let completedPoints = 0;

      for (const task of tasks.rows) {
        statusCounts[task.status] =
          (statusCounts[task.status] || 0) + 1;
        if (task.story_points) {
          totalPoints += task.story_points;
          if (task.status === 'done')
            completedPoints += task.story_points;
        }
      }

      return {
        sprint,
        tasks: tasks.rows,
        metrics: {
          total_tasks: tasks.rows.length,
          status_breakdown: statusCounts,
          total_points: totalPoints,
          completed_points: completedPoints,
          progress_pct:
            totalPoints > 0
              ? Math.round((completedPoints / totalPoints) * 100)
              : 0,
        },
      };
    },
  },

  pm_get_backlog: {
    description: `[PM Agent] Get the prioritized product backlog — all unassigned-to-sprint tasks ordered by priority.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Filter by domain' },
        type: { type: 'string', description: 'Filter by type' },
        limit: { type: 'number' },
      },
    },
    handler: async (args: any) => {
      let sql =
        "SELECT * FROM tasks WHERE sprint_id IS NULL AND status NOT IN ('done', 'cancelled')";
      const params: any[] = [];
      let idx = 1;

      if (args.domain) {
        sql += ` AND domain = $${idx++}`;
        params.push(args.domain);
      }
      if (args.type) {
        sql += ` AND type = $${idx++}`;
        params.push(args.type);
      }

      sql += ` ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        created_at ASC`;
      sql += ` LIMIT $${idx}`;
      params.push(args.limit || 100);

      const result = await query(sql, params);
      return { backlog: result.rows, count: result.rows.length };
    },
  },

  pm_get_metrics: {
    description: `[PM Agent] Get project-wide metrics — velocity, task distribution, domain coverage, agent workload.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const [byStatus, byDomain, byAgent, byType, sprints] =
        await Promise.all([
          query(
            `SELECT status, COUNT(*) as count, COALESCE(SUM(story_points), 0) as points FROM tasks GROUP BY status`,
          ),
          query(
            `SELECT domain, COUNT(*) as count FROM tasks WHERE domain IS NOT NULL GROUP BY domain ORDER BY count DESC`,
          ),
          query(
            `SELECT assigned_agent, COUNT(*) as count FROM tasks WHERE assigned_agent IS NOT NULL GROUP BY assigned_agent`,
          ),
          query(
            `SELECT type, COUNT(*) as count FROM tasks GROUP BY type ORDER BY count DESC`,
          ),
          query(
            `SELECT s.*, COUNT(t.id) as task_count, COALESCE(SUM(CASE WHEN t.status = 'done' THEN t.story_points ELSE 0 END), 0) as completed_points
             FROM sprints s LEFT JOIN tasks t ON s.id = t.sprint_id GROUP BY s.id ORDER BY s.created_at DESC LIMIT 5`,
          ),
        ]);

      return {
        by_status: byStatus.rows,
        by_domain: byDomain.rows,
        by_agent: byAgent.rows,
        by_type: byType.rows,
        recent_sprints: sprints.rows,
      };
    },
  },

  // ==========================================================================
  // PM INTERNAL API TOOLS (Staff & Analytics)
  // ==========================================================================

  pm_list_employees: {
    description: `[PM Agent] Listar empleados de la empresa vía Internal API. Retorna nombre, cargo, departamento, estado.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        position: { type: 'string', description: 'Filtrar por cargo' },
        status: { type: 'string', description: 'Filtrar por estado (active, inactive)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.position) params.set('position', args.position);
      if (args.status) params.set('status', args.status);
      const qs = params.toString();
      const res = await api.get(`/staff/employees${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { employees: res.data, count: Array.isArray(res.data) ? res.data.length : 0 };
    },
  },

  pm_get_employee: {
    description: `[PM Agent] Obtener detalle de un empleado por ID vía Internal API.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del empleado' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/staff/employees/${args.id}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { employee: res.data };
    },
  },

  pm_get_user: {
    description: `[PM Agent] Resolver un UUID de actor (changedBy / createdBy) a nombre legible. Retorna nombre del usuario humano o "Bot Novalogic" si fue una operación automatizada vía API key. Útil para mostrar el responsable en historial de envíos, cambios de estado, etc.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del actor (changedBy / createdBy)' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/staff/resolve-actor/${args.id}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { actor: res.data };
    },
  },

  pm_employee_stats: {
    description: `[PM Agent] Obtener estadísticas de empleados (totales, por estado, por departamento) vía Internal API.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/staff/employees/stats');
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { stats: res.data };
    },
  },

  pm_get_kpis: {
    description: `[PM Agent] Obtener KPIs del dashboard de analítica vía Internal API. Soporta periodo (weekly, monthly, yearly, custom).`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['weekly', 'monthly', 'yearly', 'custom'], description: 'Periodo de consulta' },
        year: { type: 'number', description: 'Año' },
        month: { type: 'number', description: 'Mes (1-12)' },
        week: { type: 'number', description: 'Semana del año' },
        sellerId: { type: 'string', description: 'UUID del vendedor (opcional)' },
        from: { type: 'string', description: 'Fecha inicio (YYYY-MM-DD) para periodo custom' },
        to: { type: 'string', description: 'Fecha fin (YYYY-MM-DD) para periodo custom' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.period) params.set('period', args.period);
      if (args.year) params.set('year', String(args.year));
      if (args.month) params.set('month', String(args.month));
      if (args.week) params.set('week', String(args.week));
      if (args.sellerId) params.set('sellerId', args.sellerId);
      if (args.from) params.set('from', args.from);
      if (args.to) params.set('to', args.to);
      const qs = params.toString();
      const res = await api.get(`/analytics/kpis${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { kpis: res.data, count: Array.isArray(res.data) ? res.data.length : 0 };
    },
  },

  pm_get_evaluation: {
    description: `[PM Agent] Obtener evaluación mensual de desempeño por rol vía Internal API. Muestra KPIs por grupo con puntaje ponderado.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number', description: 'Año de evaluación' },
        month: { type: 'number', description: 'Mes de evaluación (1-12)' },
        roleCode: { type: 'string', description: 'Código de rol (e.g., COMPANY_SELLER)' },
        sellerId: { type: 'string', description: 'UUID del vendedor (opcional)' },
      },
      required: ['roleCode'],
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      params.set('roleCode', args.roleCode);
      if (args.year) params.set('year', String(args.year));
      if (args.month) params.set('month', String(args.month));
      if (args.sellerId) params.set('sellerId', args.sellerId);
      const res = await api.get(`/analytics/evaluation/monthly?${params.toString()}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { evaluation: res.data };
    },
  },
};
