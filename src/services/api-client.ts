/**
 * HTTP client for calling the Novalogic Internal API.
 * Uses API key authentication (x-api-key header) instead of JWT.
 *
 * Env vars:
 *   NOVALOGIC_ENV             - development | staging | production
 *   NOVALOGIC_API_URL         - explicit override, takes precedence over env detection
 *   NOVALOGIC_API_URL_LOCAL   - local API URL (default: http://localhost:3005/api/v1)
 *   NOVALOGIC_API_URL_STAGING - staging API URL (default: https://staging-api.novalogic.com.co/api/v1)
 *   NOVALOGIC_API_URL_PROD    - production API URL (default: https://api.novalogic.com.co/api/v1)
 *   NOVALOGIC_API_KEY         - internal API key
 *
 * Runtime override:
 *   Use setRuntimeEnv() to switch environment per-session (stdio = per Claude instance).
 *   This does NOT modify .env files — it only changes the in-memory target for this process.
 */

export type ApiEnv = 'development' | 'staging' | 'production';

const ENV_CONFIG: Record<ApiEnv, { urlEnv: string; urlDefault: string; keyEnv: string }> = {
  development: {
    urlEnv: 'NOVALOGIC_API_URL_LOCAL',
    urlDefault: 'http://localhost:3005/api/v1',
    keyEnv: 'NOVALOGIC_API_KEY',
  },
  staging: {
    urlEnv: 'NOVALOGIC_API_URL_STAGING',
    urlDefault: 'http://localhost:3015/api/v1',
    keyEnv: 'NOVALOGIC_API_KEY',
  },
  production: {
    urlEnv: 'NOVALOGIC_API_URL_PROD',
    urlDefault: 'https://api.novalogic.com.co/api/v1',
    keyEnv: 'NOVALOGIC_API_KEY_PROD',
  },
};

function resolveApiBase(env?: ApiEnv): string {
  if (process.env.NOVALOGIC_API_URL) return process.env.NOVALOGIC_API_URL;

  const target = env || (process.env.NOVALOGIC_ENV || 'development').toLowerCase() as ApiEnv;
  const cfg = ENV_CONFIG[target] || ENV_CONFIG.development;
  return process.env[cfg.urlEnv] || cfg.urlDefault;
}

function resolveApiKey(env?: ApiEnv): string {
  const target = env || (process.env.NOVALOGIC_ENV || 'development').toLowerCase() as ApiEnv;
  if (target === 'production' && process.env.NOVALOGIC_API_KEY_PROD) {
    return process.env.NOVALOGIC_API_KEY_PROD;
  }
  return process.env.NOVALOGIC_API_KEY || '';
}

// ── Runtime state (mutable per-session) ──────────────────────────────────────

const startup = {
  env: (process.env.NOVALOGIC_ENV || 'development').toLowerCase() as ApiEnv,
  apiBase: resolveApiBase(),
  apiKey: resolveApiKey(),
  companyId: process.env.NOVALOGIC_COMPANY_ID || '',
};

let runtime: { env: ApiEnv; apiBase: string; apiKey: string; companyId: string } = { ...startup };

/** Switch the API target for this session. Does NOT touch .env files. */
export function setRuntimeEnv(env: ApiEnv, opts?: { apiKey?: string; companyId?: string }): {
  env: ApiEnv; apiBase: string; companyId: string;
} {
  const apiBase = resolveApiBase(env);
  const apiKey = opts?.apiKey || resolveApiKey(env);
  const companyId = opts?.companyId ?? runtime.companyId;

  runtime = { env, apiBase, apiKey, companyId };

  process.stderr.write(
    `[api-client] Session switched → ${env} | ${apiBase}/internal | tenant=${companyId || '(default)'}\n`,
  );

  return { env: runtime.env, apiBase: runtime.apiBase, companyId: runtime.companyId };
}

/** Get current runtime config (read-only snapshot). */
export function getRuntimeEnv() {
  return {
    env: runtime.env,
    apiBase: runtime.apiBase,
    companyId: runtime.companyId,
    startupEnv: startup.env,
  };
}

// ── Startup log ──────────────────────────────────────────────────────────────

process.stderr.write(
  `[api-client] Target: ${runtime.apiBase}/internal (env=${runtime.env})\n`,
);

if (!runtime.apiKey) {
  process.stderr.write('[api-client] WARNING: NOVALOGIC_API_KEY not set\n');
}
if (runtime.companyId) {
  process.stderr.write(`[api-client] Default tenant: ${runtime.companyId}\n`);
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

export async function apiRequest<T = any>(
  method: string,
  path: string,
  body?: any,
  companyId?: string,
): Promise<ApiResponse<T>> {
  const url = `${runtime.apiBase}/internal${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': runtime.apiKey,
  };
  const effectiveCompanyId = companyId || runtime.companyId;
  if (effectiveCompanyId) {
    headers['x-company-id'] = effectiveCompanyId;
  }

  const opts: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  const unwrapped = data?.data !== undefined ? data.data : data;

  return { ok: res.ok, status: res.status, data: unwrapped as T };
}

/**
 * Raw GET — returns the Fetch Response without JSON parsing.
 * Needed for binary endpoints (e.g. backup downloads).
 */
export async function apiGetRaw(path: string, companyId?: string): Promise<Response> {
  const url = `${runtime.apiBase}/internal${path}`;
  const headers: Record<string, string> = { 'x-api-key': runtime.apiKey };
  const effectiveCompanyId = companyId || runtime.companyId;
  if (effectiveCompanyId) headers['x-company-id'] = effectiveCompanyId;
  return fetch(url, { method: 'GET', headers });
}

export const api = {
  get: <T = any>(path: string, companyId?: string) => apiRequest<T>('GET', path, undefined, companyId),
  post: <T = any>(path: string, body?: any, companyId?: string) => apiRequest<T>('POST', path, body, companyId),
  put: <T = any>(path: string, body?: any, companyId?: string) => apiRequest<T>('PUT', path, body, companyId),
  del: <T = any>(path: string, companyId?: string) => apiRequest<T>('DELETE', path, undefined, companyId),
  patch: <T = any>(path: string, body?: any, companyId?: string) =>
    apiRequest<T>('PATCH', path, body, companyId),
  getRaw: (path: string, companyId?: string) => apiGetRaw(path, companyId),
};
