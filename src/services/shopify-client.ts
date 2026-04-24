/**
 * Shopify Admin API client (REST + GraphQL)
 *
 * Primary mode:
 * - direct access token resolved per ecommerce site from the Internal API
 *
 * Development fallback:
 * - global env vars with client_credentials flow
 */

export interface ShopifyResponse<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ShopifyClientConfig {
  shopDomain: string;
  apiVersion?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();

function normalizeShopDomain(shopDomain: string): string {
  return shopDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function cacheKey(config: ShopifyClientConfig): string {
  return `${normalizeShopDomain(config.shopDomain)}:${config.clientId || 'direct-token'}`;
}

function resolveApiVersion(config: ShopifyClientConfig): string {
  return config.apiVersion || process.env.SHOPIFY_API_VERSION || '2026-01';
}

async function getAccessToken(config: ShopifyClientConfig): Promise<string> {
  if (config.accessToken) return config.accessToken;

  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      'Shopify client is missing accessToken or client_credentials configuration',
    );
  }

  const key = cacheKey(config);
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.token;
  }

  const url = `https://${normalizeShopDomain(config.shopDomain)}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Shopify OAuth failed (${res.status}): ${err}`);
  }

  const json = await res.json();
  const token = json.access_token as string;
  tokenCache.set(key, {
    token,
    expiresAt: Date.now() + (json.expires_in || 86399) * 1000,
  });

  return token;
}

export function createShopifyClient(config: ShopifyClientConfig) {
  const shopDomain = normalizeShopDomain(config.shopDomain);
  const apiVersion = resolveApiVersion(config);

  function baseUrl() {
    return `https://${shopDomain}/admin/api/${apiVersion}`;
  }

  async function headers() {
    const token = await getAccessToken({ ...config, shopDomain, apiVersion });
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    };
  }

  async function request<T = any>(
    method: string,
    path: string,
    body?: any,
  ): Promise<ShopifyResponse<T>> {
    const url = `${baseUrl()}${path}`;
    const hdrs = await headers();
    const opts: RequestInit = { method, headers: hdrs };
    if (body !== undefined) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(url, opts);

      if (res.status === 401 && !config.accessToken) {
        tokenCache.delete(cacheKey({ ...config, shopDomain }));
        const retryHdrs = await headers();
        const retry = await fetch(url, {
          method,
          headers: retryHdrs,
          body: opts.body,
        });
        const retryData = await retry.json().catch(() => ({}));
        return { ok: retry.ok, status: retry.status, data: retryData as T };
      }

      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data: data as T };
    } catch (error: any) {
      return { ok: false, status: 0, data: { error: error.message } as any };
    }
  }

  async function graphql<T = any>(
    query: string,
    variables?: Record<string, any>,
  ): Promise<ShopifyResponse<T>> {
    const url = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;
    const hdrs = await headers();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.errors) {
        return { ok: false, status: res.status, data: json.errors };
      }
      return { ok: res.ok, status: res.status, data: json.data as T };
    } catch (error: any) {
      return { ok: false, status: 0, data: { error: error.message } as any };
    }
  }

  return {
    config: {
      shopDomain,
      apiVersion,
      hasDirectAccessToken: Boolean(config.accessToken),
    },
    get: <T = any>(path: string) => request<T>('GET', path),
    post: <T = any>(path: string, body?: any) => request<T>('POST', path, body),
    put: <T = any>(path: string, body?: any) => request<T>('PUT', path, body),
    del: <T = any>(path: string) => request<T>('DELETE', path),
    graphql,
    refreshToken: async () => {
      tokenCache.delete(cacheKey({ ...config, shopDomain }));
      return getAccessToken({ ...config, shopDomain, apiVersion });
    },
  };
}

export function getEnvShopifyClient(): ReturnType<typeof createShopifyClient> | null {
  const shopDomain = process.env.SHOPIFY_STORE_DOMAIN || '';
  if (!shopDomain) return null;

  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN || '';
  const clientId = process.env.SHOPIFY_CLIENT_ID || '';
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || '';

  if (!accessToken && (!clientId || !clientSecret)) {
    return null;
  }

  return createShopifyClient({
    shopDomain,
    accessToken: accessToken || undefined,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    apiVersion: process.env.SHOPIFY_API_VERSION || undefined,
  });
}
