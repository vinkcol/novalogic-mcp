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
 */

const LOCAL_URL = 'http://localhost:3005/api/v1';
const STAGING_URL = 'https://staging-api.novalogic.com.co/api/v1';
const PROD_URL = 'https://api.novalogic.com.co/api/v1';

function resolveApiBase(): string {
  if (process.env.NOVALOGIC_API_URL) return process.env.NOVALOGIC_API_URL;

  const env = (process.env.NOVALOGIC_ENV || 'development').toLowerCase();

  if (env === 'staging') {
    return process.env.NOVALOGIC_API_URL_STAGING || STAGING_URL;
  }

  if (env === 'production') {
    return process.env.NOVALOGIC_API_URL_PROD || PROD_URL;
  }

  return process.env.NOVALOGIC_API_URL_LOCAL || LOCAL_URL;
}

const API_BASE = resolveApiBase();
const API_KEY = process.env.NOVALOGIC_API_KEY || '';
const DEFAULT_COMPANY_ID = process.env.NOVALOGIC_COMPANY_ID || '';

process.stderr.write(
  `[api-client] Target: ${API_BASE}/internal (env=${process.env.NOVALOGIC_ENV || 'development'})\n`,
);

if (!API_KEY) {
  process.stderr.write('[api-client] WARNING: NOVALOGIC_API_KEY not set\n');
}
if (DEFAULT_COMPANY_ID) {
  process.stderr.write(`[api-client] Default tenant: ${DEFAULT_COMPANY_ID}\n`);
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
  const url = `${API_BASE}/internal${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
  const effectiveCompanyId = companyId || DEFAULT_COMPANY_ID;
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
  const url = `${API_BASE}/internal${path}`;
  const headers: Record<string, string> = { 'x-api-key': API_KEY };
  const effectiveCompanyId = companyId || DEFAULT_COMPANY_ID;
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
