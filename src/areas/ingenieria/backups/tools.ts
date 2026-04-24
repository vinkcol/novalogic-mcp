/**
 * Backups Agent — Manage pg_dump backups on the Novalogic API (local or prod).
 *
 * Backup creation is async: `backup_ops_create` returns a jobId immediately,
 * use `backup_ops_job_status` to poll. `backup_ops_pull` streams the file
 * to disk with sha256 verification when the sidecar hash is present.
 */

import { api, apiGetRaw } from '../../../services/api-client.js';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { join, resolve as resolvePath } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';

function err(message: string) {
  return { error: message };
}
function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

function resolveEnvTag(): string {
  const envName = (process.env.NOVALOGIC_ENV || 'development').toLowerCase();
  if (envName === 'production') return 'prod';
  if (envName === 'staging') return 'staging';
  return 'local';
}

function todayFolder(): string {
  return new Date().toISOString().slice(0, 10);
}

export const tools = {
  backup_ops_create: {
    description:
      '[Backups] Start an async pg_dump backup job on the API server. Returns jobId. Poll with backup_ops_job_status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        label: { type: 'string', description: 'Short label (alphanumerics and - only)' },
        format: {
          type: 'string',
          enum: ['plain', 'custom'],
          description:
            'plain = SQL+gzip (readable, slower restore). custom = pg_dump -Fc (binary, enables parallel pg_restore -j, default for big DBs).',
        },
      },
    },
    handler: async (args: any) => {
      const body: any = {};
      if (args.label) body.label = args.label;
      if (args.format) body.format = args.format;
      const res = await api.post('/backups', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ job: res.data?.job ?? res.data }, 'Backup job started');
    },
  },

  backup_ops_job_status: {
    description: '[Backups] Poll a running/completed backup job by id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        job_id: { type: 'string', description: 'UUID returned by backup_ops_create' },
      },
      required: ['job_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/backups/jobs/${args.job_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ job: res.data });
    },
  },

  backup_ops_list_jobs: {
    description: '[Backups] List recent backup jobs on the API server.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/backups/jobs');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  backup_ops_list: {
    description: '[Backups] List backup files available on the API server.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/backups');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  backup_ops_pull: {
    description:
      '[Backups] Download a backup file from the API server to local ./backups/<env>/<YYYY-MM-DD>/, streaming with sha256 verification.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filename: { type: 'string' },
      },
      required: ['filename'],
    },
    handler: async (args: any) => {
      const url = `/backups/${encodeURIComponent(args.filename)}`;
      const res = await apiGetRaw(url);
      if (!res.ok || !res.body) {
        return err(`Error ${res.status}: failed to download ${args.filename}`);
      }
      const expectedSha256 = res.headers.get('x-backup-sha256') ?? undefined;

      const envTag = resolveEnvTag();
      const targetDir = join(process.cwd(), 'backups', envTag, todayFolder());
      await mkdir(targetDir, { recursive: true });
      const targetPath = resolvePath(join(targetDir, args.filename));

      const hasher = createHash('sha256');
      const source = Readable.fromWeb(res.body as any);
      source.on('data', (chunk: Buffer) => hasher.update(chunk));

      await pipeline(source, createWriteStream(targetPath));
      const actualSha256 = hasher.digest('hex');

      const verification =
        expectedSha256 !== undefined
          ? actualSha256 === expectedSha256
            ? 'verified'
            : 'mismatch'
          : 'unverified';

      if (verification === 'mismatch') {
        return err(
          `SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}. File saved at ${targetPath} but may be corrupt.`,
        );
      }

      return ok(
        {
          filename: args.filename,
          localPath: targetPath,
          sha256: actualSha256,
          verification,
          env: envTag,
        },
        `Backup saved locally (sha256 ${verification})`,
      );
    },
  },

  backup_ops_sanitize: {
    description:
      '[Backups] Produce a PII-sanitized copy (emails/phones/tokens/cards redacted with deterministic pseudonyms). Returns substitution counts and new filename.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Source filename (plain .sql.gz format; custom dumps are binary and not sanitizable here).',
        },
      },
      required: ['filename'],
    },
    handler: async (args: any) => {
      const res = await api.post(
        `/backups/${encodeURIComponent(args.filename)}/sanitize`,
      );
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data, 'Backup sanitized');
    },
  },

  backup_ops_delete: {
    description: '[Backups] Delete a backup file (and its sha256 sidecar) from the API server.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filename: { type: 'string' },
      },
      required: ['filename'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/backups/${encodeURIComponent(args.filename)}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, `Backup ${args.filename} deleted`);
    },
  },

  backup_ops_restore_local: {
    description:
      '[Backups] Restore a local backup file into the LOCAL postgres container. DESTRUCTIVE: drops and recreates the target DB. Requires confirm=true.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        local_path: {
          type: 'string',
          description: 'Absolute or project-relative path to the .sql.gz file saved via backup_ops_pull',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to actually perform the destructive restore.',
        },
      },
      required: ['local_path', 'confirm'],
    },
    handler: async (args: any) => {
      if (!args.confirm) {
        return err('Refusing to restore: confirm must be true (destructive operation)');
      }
      const scriptPath = resolvePath(
        process.env.NOVALOGIC_PROJECT_ROOT || process.cwd(),
        'api/scripts/restore-local.sh',
      );
      const backupPath = resolvePath(args.local_path);

      return new Promise((resolveFn) => {
        const child = spawn('bash', [scriptPath, backupPath, '--yes'], {
          cwd: resolvePath(process.env.NOVALOGIC_PROJECT_ROOT || process.cwd(), 'api'),
          env: { ...process.env },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', (e) =>
          resolveFn(err(`Failed to spawn restore script: ${e.message}`)),
        );
        child.on('close', (code) => {
          if (code === 0) {
            resolveFn(
              ok({ scriptPath, backupPath, stdout }, 'Restore completed'),
            );
          } else {
            resolveFn(
              err(
                `restore-local.sh exited with code ${code}. stderr: ${stderr.slice(0, 800)}`,
              ),
            );
          }
        });
      });
    },
  },
};
