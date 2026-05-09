/**
 * Admin Ops Agent — Company, Subscription & Plan Management via Internal API
 */

import { api } from '../../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  // ──── Companies ─────────────────────────────────────────────────────────

  admin_ops_list_companies: {
    description: '[Admin Ops] Listar empresas registradas con filtros y paginacion.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number', description: 'Pagina (default 1)' },
        limit: { type: 'number', description: 'Items por pagina (default 50)' },
        status: { type: 'string', description: 'Filtrar por estado' },
        search: { type: 'string', description: 'Buscar por nombre' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.status) params.set('status', args.status);
      if (args.search) params.set('search', args.search);
      const res = await api.get(`/admin/companies?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ companies: res.data });
    },
  },

  admin_ops_get_company: {
    description: '[Admin Ops] Obtener detalle de una empresa por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.get(`/admin/companies/${args.company_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ company: res.data });
    },
  },

  admin_ops_company_stats: {
    description: '[Admin Ops] Estadisticas de empresas (total, activas, por tipo).',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/admin/companies/stats');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ stats: res.data });
    },
  },

  admin_ops_create_company: {
    description: '[Admin Ops] Crear nueva empresa aliada (merchant o carrier).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre comercial de la empresa' },
        company_type: { type: 'string', enum: ['merchant', 'carrier'], description: 'Tipo: merchant (ERP) o carrier (transportadora)' },
        legal_name: { type: 'string', description: 'Razón social / nombre legal' },
        tax_id: { type: 'string', description: 'NIT o identificación tributaria' },
        admin_first_name: { type: 'string', description: 'Nombre del administrador inicial' },
        admin_last_name: { type: 'string', description: 'Apellido del administrador inicial' },
        admin_email: { type: 'string', description: 'Email del administrador inicial (credenciales de acceso)' },
        admin_password: { type: 'string', description: 'Contraseña del administrador inicial' },
        email: { type: 'string', description: 'Email de contacto de la empresa' },
        phone: { type: 'string', description: 'Teléfono de la empresa' },
        admin_phone: { type: 'string', description: 'Teléfono del administrador' },
        website: { type: 'string', description: 'Sitio web' },
        max_users: { type: 'number', description: 'Límite de usuarios (-1 = ilimitado)' },
      },
      required: ['name', 'legal_name', 'tax_id', 'admin_first_name', 'admin_last_name', 'admin_email', 'admin_password'],
    },
    handler: async (args: any) => {
      const res = await api.post('/admin/companies', {
        name: args.name,
        companyType: args.company_type,
        legalName: args.legal_name,
        taxId: args.tax_id,
        adminFirstName: args.admin_first_name,
        adminLastName: args.admin_last_name,
        adminEmail: args.admin_email,
        adminPassword: args.admin_password,
        email: args.email,
        phone: args.phone,
        adminPhone: args.admin_phone,
        website: args.website,
        maxUsers: args.max_users,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ company: res.data }, 'Empresa creada');
    },
  },

  admin_ops_create_company_admin: {
    description: '[Admin Ops] Crear usuario admin para una empresa existente (backfill). Asigna COMPANY_ADMIN o CARRIER_ADMIN según el tipo de empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string', description: 'UUID de la empresa' },
        first_name: { type: 'string', description: 'Nombre del admin' },
        last_name: { type: 'string', description: 'Apellido del admin' },
        email: { type: 'string', description: 'Email (credencial de acceso)' },
        password: { type: 'string', description: 'Contraseña' },
        phone: { type: 'string', description: 'Teléfono (opcional)' },
      },
      required: ['company_id', 'first_name', 'last_name', 'email', 'password'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.post(`/admin/companies/${args.company_id}/admin-user`, {
        first_name: args.first_name,
        last_name: args.last_name,
        email: args.email,
        password: args.password,
        phone: args.phone,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ user: res.data.user, role: res.data.role }, `Usuario ${args.email} creado con rol ${res.data.role}`);
    },
  },

  admin_ops_delete_company: {
    description: '[Admin Ops] Soft delete de una empresa (reversible, marca como eliminada).',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.del(`/admin/companies/${args.company_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Empresa eliminada (soft delete)');
    },
  },

  admin_ops_hard_delete_company: {
    description: '[Admin Ops] Hard delete de una empresa (IRREVERSIBLE, borra permanentemente de la DB).',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.del(`/admin/companies/${args.company_id}/hard`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Empresa eliminada permanentemente (hard delete)');
    },
  },

  admin_ops_activate_company: {
    description: '[Admin Ops] Activar una empresa suspendida.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.patch(`/admin/companies/${args.company_id}/activate`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ company: res.data }, 'Empresa activada');
    },
  },

  admin_ops_suspend_company: {
    description: '[Admin Ops] Suspender una empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.patch(`/admin/companies/${args.company_id}/suspend`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ company: res.data }, 'Empresa suspendida');
    },
  },

  // ──── Subscriptions ─────────────────────────────────────────────────────

  admin_ops_list_subscriptions: {
    description: '[Admin Ops] Listar todas las suscripciones con filtros.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number' },
        limit: { type: 'number' },
        status: { type: 'string', description: 'trialing, active, past_due, canceled, expired, paused' },
        plan_level: { type: 'string', description: 'free, basic, professional, enterprise, etc.' },
        search: { type: 'string' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.status) params.set('status', args.status);
      if (args.plan_level) params.set('planLevel', args.plan_level);
      if (args.search) params.set('search', args.search);
      const res = await api.get(`/admin/subscriptions?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscriptions: res.data });
    },
  },

  admin_ops_get_subscription: {
    description: '[Admin Ops] Obtener suscripcion de una empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.get(`/admin/subscriptions/company/${args.company_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscription: res.data });
    },
  },

  admin_ops_get_usage: {
    description: '[Admin Ops] Ver uso actual vs limites de una empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.get(`/admin/subscriptions/company/${args.company_id}/usage`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ usage: res.data });
    },
  },

  admin_ops_get_alerts: {
    description: '[Admin Ops] Ver alertas de limites de uso de una empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.get(`/admin/subscriptions/company/${args.company_id}/alerts`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ alerts: res.data });
    },
  },

  admin_ops_change_plan: {
    description: '[Admin Ops] Cambiar el plan de una empresa (idempotente por company_id).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string', description: 'UUID de la empresa' },
        plan_id: { type: 'string', description: 'UUID del nuevo plan' },
      },
      required: ['company_id', 'plan_id'],
    },
    handler: async (args: any) => {
      const res = await api.put(`/admin/companies/${args.company_id}/plan`, {
        planId: args.plan_id,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscription: res.data }, 'Plan actualizado');
    },
  },

  admin_ops_update_modules: {
    description: '[Admin Ops] Actualizar modulos habilitados de una empresa (idempotente por company_id).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string', description: 'UUID de la empresa' },
        modules: {
          type: 'array',
          description: 'Lista de modulos habilitados (ej: ["sales", "pos", "inventory"])',
          items: { type: 'string' },
        },
      },
      required: ['company_id', 'modules'],
    },
    handler: async (args: any) => {
      const res = await api.put(`/admin/companies/${args.company_id}/modules`, {
        modules: args.modules,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscription: res.data }, 'Modulos actualizados');
    },
  },

  admin_ops_activate_subscription: {
    description: '[Admin Ops] Activar suscripcion suspendida (idempotente por company_id).',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.patch(`/admin/companies/${args.company_id}/subscription/activate`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscription: res.data }, 'Suscripcion activada');
    },
  },

  admin_ops_suspend_subscription: {
    description: '[Admin Ops] Suspender/pausar suscripcion (idempotente por company_id).',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.patch(`/admin/companies/${args.company_id}/subscription/suspend`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscription: res.data }, 'Suscripcion suspendida');
    },
  },

  admin_ops_convert_trial: {
    description: '[Admin Ops] Convertir suscripcion de trial a pago (idempotente por company_id).',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      if (!args.company_id) return err("company_id es requerido");
      const res = await api.patch(`/admin/companies/${args.company_id}/subscription/convert-from-trial`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscription: res.data }, 'Trial convertido a activo');
    },
  },

  admin_ops_extend_trial: {
    description: '[Admin Ops] Extender periodo de prueba (idempotente por company_id).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string', description: 'UUID de la empresa' },
        days: { type: 'number', description: 'Dias a extender (default 30)' },
      },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      const days = args.days || 30;
      const res = await api.patch(`/admin/companies/${args.company_id}/subscription/extend-trial?days=${days}`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subscription: res.data }, `Trial extendido ${days} dias`);
    },
  },

  // ──── Plans ─────────────────────────────────────────────────────────────

  admin_ops_list_plans: {
    description: '[Admin Ops] Listar todos los planes disponibles.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/plans');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ plans: res.data });
    },
  },

  admin_ops_get_plan: {
    description: '[Admin Ops] Obtener detalle de un plan por ID (features, limits).',
    inputSchema: {
      type: 'object' as const,
      properties: { plan_id: { type: 'string' } },
      required: ['plan_id'],
    },
    handler: async (args: any) => {
      if (!args.plan_id) return err("plan_id es requerido");
      const res = await api.get(`/plans/${args.plan_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ plan: res.data });
    },
  },

  admin_ops_plans_by_scope: {
    description: '[Admin Ops] Listar planes activos por scope (merchant o carrier).',
    inputSchema: {
      type: 'object' as const,
      properties: { scope: { type: 'string', description: 'merchant o carrier' } },
      required: ['scope'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/plans/scope/${args.scope}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ plans: res.data });
    },
  },

  admin_ops_create_plan: {
    description: '[Admin Ops] Crear nuevo plan con features y limits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre del plan' },
        level: { type: 'string', description: 'Nivel unico (ej: basic, pro)' },
        scope: { type: 'string', description: 'merchant o carrier' },
        price: { type: 'number', description: 'Precio mensual' },
        billingPeriod: { type: 'string', description: 'Periodo de facturacion: monthly, yearly, lifetime' },
        trialDays: { type: 'number', description: 'Dias de prueba (0 para planes sin trial)' },
        features: {
          type: 'array',
          description: 'Features del plan',
          items: { type: 'object', properties: { key: { type: 'string' }, isEnabled: { type: 'boolean' } } },
        },
        limits: {
          type: 'array',
          description: 'Limites del plan',
          items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'number' } } },
        },
      },
      required: ['name', 'level', 'price'],
    },
    handler: async (args: any) => {
      const res = await api.post('/plans', args);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ plan: res.data }, 'Plan creado');
    },
  },

  admin_ops_update_plan: {
    description: '[Admin Ops] Actualizar un plan (crea nueva version automaticamente).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        plan_id: { type: 'string' },
        name: { type: 'string' },
        price: { type: 'number' },
        features: { type: 'array', items: { type: 'object' } },
        limits: { type: 'array', items: { type: 'object' } },
      },
      required: ['plan_id'],
    },
    handler: async (args: any) => {
      const { plan_id, ...data } = args;
      const res = await api.put(`/plans/${plan_id}`, data);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ plan: res.data }, 'Plan actualizado (nueva version creada)');
    },
  },

  admin_ops_activate_plan: {
    description: '[Admin Ops] Activar un plan desactivado.',
    inputSchema: {
      type: 'object' as const,
      properties: { plan_id: { type: 'string' } },
      required: ['plan_id'],
    },
    handler: async (args: any) => {
      if (!args.plan_id) return err("plan_id es requerido");
      const res = await api.patch(`/plans/${args.plan_id}/activate`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Plan activado');
    },
  },

  admin_ops_deactivate_plan: {
    description: '[Admin Ops] Desactivar un plan.',
    inputSchema: {
      type: 'object' as const,
      properties: { plan_id: { type: 'string' } },
      required: ['plan_id'],
    },
    handler: async (args: any) => {
      if (!args.plan_id) return err("plan_id es requerido");
      const res = await api.patch(`/plans/${args.plan_id}/deactivate`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Plan desactivado');
    },
  },

  // ──── Addons ────────────────────────────────────────────────────────────

  admin_ops_list_addons: {
    description: '[Admin Ops] Listar addons disponibles.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/plans/addons');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ addons: res.data });
    },
  },

  admin_ops_create_addon: {
    description: '[Admin Ops] Crear nuevo addon.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre del addon' },
        scope: { type: 'string', description: 'merchant o carrier' },
        addon_type: { type: 'string', description: 'feature, limit_increase o bundle' },
        feature_key: { type: 'string', description: 'Feature key (si tipo=feature)' },
        limit_key: { type: 'string', description: 'Limit key (si tipo=limit_increase)' },
        limit_increase: { type: 'number', description: 'Incremento de limite' },
        price: { type: 'number', description: 'Precio mensual' },
      },
      required: ['name', 'addon_type', 'price'],
    },
    handler: async (args: any) => {
      const res = await api.post('/plans/addons', {
        name: args.name,
        scope: args.scope,
        addonType: args.addon_type,
        featureKey: args.feature_key,
        limitKey: args.limit_key,
        limitIncrease: args.limit_increase,
        price: args.price,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ addon: res.data }, 'Addon creado');
    },
  },

  // ──── Users ─────────────────────────────────────────────────────────────

  admin_ops_reset_password: {
    description: '[Admin Ops] Resetear contraseña de un usuario por email. Requiere scope admin:write.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email del usuario' },
        new_password: { type: 'string', description: 'Nueva contraseña' },
      },
      required: ['email', 'new_password'],
    },
    handler: async (args: any) => {
      if (!args.email || !args.new_password) return err('email y new_password son requeridos');
      const res = await api.post('/admin/users/reset-password', {
        email: args.email,
        newPassword: args.new_password,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ user: res.data }, `Contraseña actualizada para ${args.email}`);
    },
  },

  // ──── Dashboard Overview ──────────────────────────────────────────────────

  admin_ops_dashboard_overview: {
    description: '[Admin Ops] Dashboard completo de empresa — hero KPIs, ventas, logística, clientes, financiero, tendencias. Soporta filtro por rango de fechas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional, sin filtro = todo)' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional, sin filtro = todo)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.start_date) params.append('startDate', args.start_date);
      if (args.end_date) params.append('endDate', args.end_date);
      const qs = params.toString();
      const path = `/dashboard/overview${qs ? `?${qs}` : ''}`;
      const res = await api.get(path);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ overview: res.data });
    },
  },

  admin_ops_dashboard_rebuild: {
    description: '[Admin Ops] Reconstruir rollups y snapshots de telemetría para la empresa. Ejecutar si el dashboard overview muestra datos en cero.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.post('/dashboard/rebuild');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ result: res.data }, 'Rollups y snapshots reconstruidos');
    },
  },

  admin_ops_create_api_key: {
    description: '[Admin Ops] Crear una nueva API key para una empresa. Devuelve la rawKey UNA SOLA VEZ — guardarla inmediatamente. Scopes comunes: ecommerce:* para tienda virtual, logistics:read para integraciones.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre descriptivo (ej: "vink-shop-ecommerce")' },
        company_id: { type: 'string', description: 'UUID de la empresa' },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scopes: ecommerce:*, logistics:read, sales:read, etc.',
        },
        rate_limit: { type: 'number', description: 'Requests por minuto (default 100)' },
        expires_at: { type: 'string', description: 'Fecha de expiración ISO 8601 (opcional)' },
      },
      required: ['name', 'company_id', 'scopes'],
    },
    handler: async (args: any) => {
      const res = await api.post('/admin/api-keys', {
        name: args.name,
        companyId: args.company_id,
        scopes: args.scopes,
        rateLimit: args.rate_limit,
        expiresAt: args.expires_at,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ api_key: res.data }, 'API Key creada. Guarda el rawKey — no se puede recuperar.');
    },
  },

  admin_ops_list_api_keys: {
    description: '[Admin Ops] Listar todas las API keys (valores enmascarados — la rawKey nunca se puede recuperar).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/admin/api-keys');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ api_keys: res.data });
    },
  },

  admin_ops_update_api_key_scopes: {
    description: '[Admin Ops] Actualizar los scopes de una API key existente. Reemplaza todos los scopes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        api_key_id: { type: 'string', description: 'UUID de la API key' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'Lista completa de scopes (ej: ["sales:read", "payments:write"])' },
      },
      required: ['api_key_id', 'scopes'],
    },
    handler: async (args: any) => {
      const res = await api.patch(`/admin/api-keys/${args.api_key_id}/scopes`, { scopes: args.scopes });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ api_key: res.data?.data ?? res.data }, 'Scopes actualizados');
    },
  },

  admin_ops_hard_delete_user: {
    description: '[Admin Ops] Hard delete de un usuario (IRREVERSIBLE). Elimina user_roles, refresh_tokens, credentials y el user.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user_id: { type: 'string', description: 'UUID del usuario a eliminar' },
        email: { type: 'string', description: 'Email del usuario (confirmacion visual)' },
      },
      required: ['user_id'],
    },
    handler: async (args: any) => {
      if (!args.user_id) return err('user_id es requerido');
      const res = await api.del(`/admin/users/${args.user_id}/hard`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, `Usuario ${args.email || args.user_id} eliminado permanentemente`);
    },
  },

  // ─── Provision Tenant (all-in-one) ───────────────────────────────────────

  admin_ops_provision_tenant: {
    description: '[Admin Ops] Provisionar tenant completo: empresa + admin user + plan + API key (ecommerce:*) + ecommerce site con subdomainSlug. Retorna IDs y rawKey.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'Nombre comercial' },
        legal_name: { type: 'string', description: 'Razon social' },
        tax_id: { type: 'string', description: 'NIT' },
        admin_email: { type: 'string', description: 'Email del admin' },
        admin_password: { type: 'string', description: 'Password del admin' },
        admin_first_name: { type: 'string', description: 'Nombre del admin' },
        admin_last_name: { type: 'string', description: 'Apellido del admin' },
        plan_id: { type: 'string', description: 'UUID del plan (debe tener ecommerce)' },
        subdomain_slug: { type: 'string', description: 'Slug subdominio (ej: mitienda)' },
        primary_color: { type: 'string', description: 'Color primario hex (ej: #2563eb)' },
        phone: { type: 'string', description: 'Telefono/WhatsApp' },
        email: { type: 'string', description: 'Email de contacto tienda' },
      },
      required: ['company_name', 'legal_name', 'tax_id', 'admin_email', 'admin_password', 'admin_first_name', 'admin_last_name', 'plan_id', 'subdomain_slug'],
    },
    handler: async (args: any) => {
      const results: any = {};

      // 1. Crear empresa (incluye admin user via createCompanyWithDefaults)
      const companyRes = await api.post('/admin/companies', {
        name: args.company_name,
        legalName: args.legal_name,
        taxId: args.tax_id,
        adminFirstName: args.admin_first_name,
        adminLastName: args.admin_last_name,
        adminEmail: args.admin_email,
        adminPassword: args.admin_password,
        email: args.email || args.admin_email,
        phone: args.phone,
        companyType: 'merchant',
      });
      if (!companyRes.ok) return err('Crear empresa: ' + JSON.stringify(companyRes.data));
      const companyId = companyRes.data?.id;
      if (!companyId) return err('No se obtuvo companyId');
      results.company = { id: companyId, name: args.company_name };

      // 2. Asignar plan
      const planRes = await api.put('/admin/subscriptions/company/' + companyId + '/plan', { planId: args.plan_id });
      if (!planRes.ok) return err('Asignar plan: ' + JSON.stringify(planRes.data));
      results.plan = { id: args.plan_id, assigned: true };

      // 3. Crear API key
      const keyRes = await api.post('/admin/api-keys', {
        name: args.subdomain_slug + '-catalog',
        companyId,
        scopes: ['ecommerce:*'],
      });
      if (!keyRes.ok) return err('Crear API key: ' + JSON.stringify(keyRes.data));
      results.apiKey = { id: keyRes.data?.id, rawKey: keyRes.data?.rawKey };

      // 4. Crear ecommerce site
      const siteHeaders = { 'x-company-id': companyId };
      const siteRes = await api.post('/ecommerce-sites', {
        name: args.company_name,
        type: 'CATALOG',
        websiteUrl: 'https://' + args.subdomain_slug + '.store.novalogic.com.co',
      }, { headers: siteHeaders });
      if (!siteRes.ok) return err('Crear site: ' + JSON.stringify(siteRes.data));
      const siteId = siteRes.data?.id;
      results.site = { id: siteId };

      // 5. Configurar subdomainSlug + apariencia
      const updatePayload: any = {
        subdomainSlug: args.subdomain_slug,
        description: 'Tienda online de ' + args.company_name,
        currency: 'COP',
        locale: 'es-CO',
        timezone: 'America/Bogota',
      };
      if (args.primary_color) updatePayload.appearance = { primaryColor: args.primary_color, theme: 'light' };
      if (args.phone) updatePayload.contact = { phone: args.phone, whatsapp: args.phone, email: args.email || args.admin_email };
      await api.put('/ecommerce-sites/' + siteId, updatePayload, { headers: siteHeaders });

      results.catalogUrl = 'https://novalogic-catalog.netlify.app/?tenant=' + args.subdomain_slug;
      results.dashboardLogin = { email: args.admin_email, url: 'https://cloud.novalogic.com.co/acceso' };

      return ok(results, 'Tenant "' + args.company_name + '" provisionado. API key: ' + (results.apiKey?.rawKey || 'ver results'));
    },
  },

};

export const provisionTenantTool = {
  admin_ops_provision_tenant: {
    description: '[Admin Ops] Provisionar un tenant completo en un solo paso: crea empresa, admin user, asigna plan, genera API key (ecommerce:*), crea ecommerce site con subdomainSlug y config. Retorna todos los IDs y la rawKey.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'Nombre comercial' },
        legal_name: { type: 'string', description: 'Razón social' },
        tax_id: { type: 'string', description: 'NIT' },
        admin_email: { type: 'string', description: 'Email del admin' },
        admin_password: { type: 'string', description: 'Contraseña del admin' },
        admin_first_name: { type: 'string', description: 'Nombre del admin' },
        admin_last_name: { type: 'string', description: 'Apellido del admin' },
        plan_id: { type: 'string', description: 'UUID del plan a asignar (debe tener ecommerce)' },
        subdomain_slug: { type: 'string', description: 'Slug para subdominio (ej: "mitienda" → mitienda.store.novalogic.com.co)' },
        primary_color: { type: 'string', description: 'Color primario hex (ej: #2563eb)' },
        phone: { type: 'string', description: 'Teléfono/WhatsApp de contacto' },
        email: { type: 'string', description: 'Email de contacto de la tienda' },
      },
      required: ['company_name', 'legal_name', 'tax_id', 'admin_email', 'admin_password', 'admin_first_name', 'admin_last_name', 'plan_id', 'subdomain_slug'],
    },
    handler: async (args: any) => {
      const results: any = {};

      // 1. Crear empresa
      const companyRes = await api.post('/admin/companies', {
        name: args.company_name,
        legalName: args.legal_name,
        taxId: args.tax_id,
        adminFirstName: args.admin_first_name,
        adminLastName: args.admin_last_name,
        adminEmail: args.admin_email,
        adminPassword: args.admin_password,
        email: args.email || args.admin_email,
        phone: args.phone,
        companyType: 'merchant',
      });
      if (!companyRes.ok) return err(`Crear empresa falló: ${JSON.stringify(companyRes.data)}`);
      const companyId = companyRes.data?.id;
      if (!companyId) return err('No se obtuvo companyId');
      results.company = { id: companyId, name: args.company_name };

      // 2. Asignar plan
      const planRes = await api.put(`/admin/subscriptions/company/${companyId}/plan`, { planId: args.plan_id });
      if (!planRes.ok) return err(`Asignar plan falló: ${JSON.stringify(planRes.data)}`);
      results.plan = { id: args.plan_id, assigned: true };

      // 3. Crear API key
      const keyRes = await api.post('/admin/api-keys', {
        name: `${args.subdomain_slug}-catalog`,
        companyId,
        scopes: ['ecommerce:*'],
      });
      if (!keyRes.ok) return err(`Crear API key falló: ${JSON.stringify(keyRes.data)}`);
      results.apiKey = { id: keyRes.data?.id, rawKey: keyRes.data?.rawKey, name: keyRes.data?.name };

      // 4. Crear ecommerce site
      const siteRes = await api.post('/ecommerce-sites', {
        name: args.company_name,
        type: 'CATALOG',
        websiteUrl: `https://${args.subdomain_slug}.store.novalogic.com.co`,
      }, { headers: { 'x-company-id': companyId } });
      if (!siteRes.ok) return err(`Crear site falló: ${JSON.stringify(siteRes.data)}`);
      const siteId = siteRes.data?.id;
      results.site = { id: siteId, slug: siteRes.data?.slug };

      // 5. Configurar subdomainSlug
      await api.put(`/ecommerce-sites/${siteId}`, { subdomainSlug: args.subdomain_slug }, { headers: { 'x-company-id': companyId } });

      // 6. Configurar apariencia y contacto
      const configPayload: any = { currency: 'COP', locale: 'es-CO', timezone: 'America/Bogota' };
      if (args.primary_color) configPayload.appearance = { primaryColor: args.primary_color, theme: 'light' };
      if (args.phone) configPayload.contact = { phone: args.phone, whatsapp: args.phone, email: args.email || args.admin_email };
      configPayload.description = `Tienda online de ${args.company_name}`;

      await api.put(`/ecommerce-sites/${siteId}`, configPayload, { headers: { 'x-company-id': companyId } });

      results.catalogUrl = `https://novalogic-catalog.netlify.app/?tenant=${args.subdomain_slug}`;
      results.dashboardLogin = { email: args.admin_email, url: 'https://cloud.novalogic.com.co/acceso' };

      return ok(results, `Tenant "${args.company_name}" provisionado. API key (guardar): ${results.apiKey?.rawKey}`);
    },
  },
};
