import { existsSync, readFileSync, writeFileSync } from 'fs';
import { encryptJson, decryptJson } from './crypto.js';
import { tenantPath, ensureTenantDirs } from './tenant-storage.js';

export const PUBLIC_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
export const DEFAULT_SCOPES = [
  'offline_access',
  'User.Read',
  'Files.ReadWrite.All',
  'Sites.ReadWrite.All',
];

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
  id_token?: string;
}

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scopes: string[];
  tenant_id?: string;
  obtained_at: number;
}

export interface PendingDeviceFlow {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_at: number;
  interval: number;
  scopes: string[];
  client_id: string;
  started_at: number;
}

function tokenFile(slug: string): string {
  return tenantPath(slug, 'integrations', '.microsoft.tokens.enc');
}

function pendingFile(slug: string): string {
  return tenantPath(slug, 'integrations', '.microsoft.pending.json');
}

export async function startDeviceFlow(
  slug: string,
  scopes: string[] = DEFAULT_SCOPES,
  clientId: string = PUBLIC_CLIENT_ID,
): Promise<PendingDeviceFlow> {
  ensureTenantDirs(slug);
  const body = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(' '),
  });
  const response = await fetch(`${AUTHORITY}/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Device code request failed ${response.status}: ${text}`);
  }
  const data = (await response.json()) as DeviceCodeResponse;
  const pending: PendingDeviceFlow = {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_at: Date.now() + data.expires_in * 1000,
    interval: Math.max(data.interval || 5, 1),
    scopes,
    client_id: clientId,
    started_at: Date.now(),
  };
  writeFileSync(pendingFile(slug), JSON.stringify(pending, null, 2), 'utf-8');
  return pending;
}

export function readPending(slug: string): PendingDeviceFlow | null {
  const p = pendingFile(slug);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as PendingDeviceFlow;
}

export async function pollDeviceFlow(slug: string): Promise<
  | { status: 'pending'; retry_in: number }
  | { status: 'expired' }
  | { status: 'completed'; user: GraphUser; tokens: StoredTokens }
  | { status: 'error'; error: string; description?: string }
> {
  const pending = readPending(slug);
  if (!pending) {
    return { status: 'error', error: 'no_pending_flow' };
  }
  if (Date.now() > pending.expires_at) {
    return { status: 'expired' };
  }
  const body = new URLSearchParams({
    client_id: pending.client_id,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: pending.device_code,
  });
  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await response.json()) as any;

  if (response.ok) {
    const tokenPayload = data as TokenResponse;
    const tokens: StoredTokens = {
      access_token: tokenPayload.access_token,
      refresh_token: tokenPayload.refresh_token,
      expires_at: Date.now() + tokenPayload.expires_in * 1000,
      scopes: (tokenPayload.scope || pending.scopes.join(' '))
        .split(' ')
        .filter(Boolean),
      obtained_at: Date.now(),
    };
    const user = await fetchMe(tokens.access_token);
    tokens.tenant_id = extractTenantId(tokenPayload.id_token);
    persistTokens(slug, tokens);
    clearPending(slug);
    return { status: 'completed', user, tokens };
  }

  if (data.error === 'authorization_pending') {
    return { status: 'pending', retry_in: pending.interval };
  }
  if (data.error === 'slow_down') {
    pending.interval += 5;
    writeFileSync(pendingFile(slug), JSON.stringify(pending, null, 2), 'utf-8');
    return { status: 'pending', retry_in: pending.interval };
  }
  if (data.error === 'expired_token' || data.error === 'code_expired') {
    clearPending(slug);
    return { status: 'expired' };
  }
  return {
    status: 'error',
    error: data.error,
    description: data.error_description,
  };
}

export interface GraphUser {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
  givenName?: string;
  surname?: string;
  preferredLanguage?: string;
  jobTitle?: string;
}

async function fetchMe(accessToken: string): Promise<GraphUser> {
  const response = await fetch(`${GRAPH_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch /me: ${response.status}`);
  }
  return (await response.json()) as GraphUser;
}

function extractTenantId(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return undefined;
    const claims = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );
    return claims.tid as string | undefined;
  } catch {
    return undefined;
  }
}

function persistTokens(slug: string, tokens: StoredTokens): void {
  const enc = encryptJson(tokens);
  writeFileSync(tokenFile(slug), enc, 'utf-8');
}

export function readTokens(slug: string): StoredTokens | null {
  const p = tokenFile(slug);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf-8');
  return decryptJson<StoredTokens>(raw);
}

export function clearPending(slug: string): void {
  const p = pendingFile(slug);
  if (existsSync(p)) {
    try {
      writeFileSync(p, '', 'utf-8');
    } catch {
      // ignore
    }
  }
}

export async function refreshTokens(slug: string): Promise<StoredTokens> {
  const existing = readTokens(slug);
  if (!existing?.refresh_token) {
    throw new Error('No refresh token available — re-authenticate required');
  }
  const body = new URLSearchParams({
    client_id: PUBLIC_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: existing.refresh_token,
    scope: existing.scopes.join(' '),
  });
  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(
      `Refresh failed: ${data.error} ${data.error_description || ''}`,
    );
  }
  const tokens: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || existing.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scopes: existing.scopes,
    tenant_id: existing.tenant_id,
    obtained_at: Date.now(),
  };
  persistTokens(slug, tokens);
  return tokens;
}

export async function getValidAccessToken(slug: string): Promise<string> {
  const tokens = readTokens(slug);
  if (!tokens) {
    throw new Error('No stored tokens — run ms_auth_start first');
  }
  if (tokens.expires_at - Date.now() > 60_000) {
    return tokens.access_token;
  }
  const refreshed = await refreshTokens(slug);
  return refreshed.access_token;
}
