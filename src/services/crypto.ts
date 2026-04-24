import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const raw = process.env.MCP_TOKEN_ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, 'hex');
    if (key.length !== 32) {
      throw new Error(
        'MCP_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)',
      );
    }
    return key;
  }
  if (!globalCachedKey) {
    globalCachedKey = randomBytes(32);
    process.stderr.write(
      '[novalogic-mcp] Warning: MCP_TOKEN_ENCRYPTION_KEY not set — using ephemeral key (tokens will be lost on restart)\n',
    );
  }
  return globalCachedKey;
}

let globalCachedKey: Buffer | null = null;

export function encryptJson(data: unknown): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptJson<T = unknown>(payload: string): T {
  const key = getKey();
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf-8')) as T;
}
