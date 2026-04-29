import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { ToolDefinition } from '../../../../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGING_ROOT = resolve(
  process.env.NOVALOGIC_MESSAGING_ROOT ||
    join(__dirname, '..', '..', '..', '..', '..', 'messaging'),
);

const SLUG_RE = /^[a-z0-9-]+$/;

function assertSlug(slug: string): void {
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(`Invalid room slug: "${slug}" (allowed: a-z 0-9 -)`);
  }
}

function roomPath(slug: string, ...segments: string[]): string {
  assertSlug(slug);
  const full = resolve(MESSAGING_ROOT, slug, ...segments);
  if (!full.startsWith(resolve(MESSAGING_ROOT, slug))) {
    throw new Error('Path traversal detected');
  }
  return full;
}

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function parseMessages(content: string): Array<{
  author: string;
  timestamp: string;
  body: string;
}> {
  const re = /^### \[([^\]]+)\]\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/gm;
  const messages: Array<{ author: string; timestamp: string; body: string }> =
    [];
  const matches: Array<{ author: string; timestamp: string; index: number }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    matches.push({ author: m[1], timestamp: m[2], index: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const body = content.slice(start, end).replace(/^\s+/, '').replace(/\n---\s*$/, '').trim();
    messages.push({ author: matches[i].author, timestamp: matches[i].timestamp, body });
  }
  return messages;
}

export const tools: Record<string, ToolDefinition> = {
  chat_room_list: {
    description:
      '[Messaging] List all chat rooms under messaging/. Returns slug + participants + last message timestamp.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      if (!existsSync(MESSAGING_ROOT)) return { root: MESSAGING_ROOT, rooms: [] };
      const rooms: Array<any> = [];
      for (const entry of readdirSync(MESSAGING_ROOT)) {
        const dir = join(MESSAGING_ROOT, entry);
        try {
          if (!statSync(dir).isDirectory() || !SLUG_RE.test(entry)) continue;
        } catch {
          continue;
        }
        const chatPath = join(dir, 'chat.md');
        if (!existsSync(chatPath)) continue;
        const content = readFileSync(chatPath, 'utf-8');
        const msgs = parseMessages(content);
        const last = msgs[msgs.length - 1];
        rooms.push({
          slug: entry,
          message_count: msgs.length,
          last_author: last?.author || null,
          last_timestamp: last?.timestamp || null,
          participants: Array.from(new Set(msgs.map((m) => m.author))),
        });
      }
      return { root: MESSAGING_ROOT, rooms };
    },
  },

  chat_room_create: {
    description:
      '[Messaging] Create a new chat room with README + empty chat.md. Fails if room already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Room slug (a-z 0-9 -)' },
        topic: { type: 'string', description: 'One-line description' },
        participants: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Author tags (e.g. ["NOVALOGIC","MCP-PERSONAL"]). Used for validation and README.',
        },
      },
      required: ['slug', 'topic', 'participants'],
    },
    handler: async ({
      slug,
      topic,
      participants,
    }: {
      slug: string;
      topic: string;
      participants: string[];
    }) => {
      assertSlug(slug);
      const dir = roomPath(slug);
      if (existsSync(dir)) throw new Error(`Room already exists: ${slug}`);
      mkdirSync(dir, { recursive: true });

      const readme = `# Chat Room — ${slug}\n\n**Topic:** ${topic}\n\n**Participants:** ${participants.join(
        ', ',
      )}\n\n## Protocol\n- Append-only (never edit prior messages)\n- Block header: \`### [AUTHOR] YYYY-MM-DD HH:MM\`\n- Separator \`---\` between messages\n\n## File\n- \`chat.md\` — the thread\n\nManaged via MCP tools \`chat_post\`, \`chat_read\`, \`chat_read_unread\`.\n`;
      const chat = `# Chat — ${topic}\n\n`;

      writeFileSync(join(dir, 'README.md'), readme, 'utf-8');
      writeFileSync(join(dir, 'chat.md'), chat, 'utf-8');

      return { ok: true, slug, path: dir };
    },
  },

  chat_post: {
    description:
      '[Messaging] Append a message to a chat room. Timestamp is generated automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        author: {
          type: 'string',
          description: 'Author tag (e.g. "NOVALOGIC", "MCP-PERSONAL")',
        },
        message: { type: 'string', description: 'Markdown body' },
      },
      required: ['slug', 'author', 'message'],
    },
    handler: async ({
      slug,
      author,
      message,
    }: {
      slug: string;
      author: string;
      message: string;
    }) => {
      const chatPath = roomPath(slug, 'chat.md');
      if (!existsSync(chatPath)) throw new Error(`Room not found: ${slug}`);
      const block = `\n### [${author}] ${now()}\n\n${message.trim()}\n\n---\n`;
      appendFileSync(chatPath, block, 'utf-8');
      return { ok: true, slug, author, timestamp: now() };
    },
  },

  chat_read: {
    description:
      '[Messaging] Read messages from a chat room. Returns all messages or only the last N if tail is set.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        tail: {
          type: 'number',
          description: 'Return only the last N messages (optional)',
        },
      },
      required: ['slug'],
    },
    handler: async ({ slug, tail }: { slug: string; tail?: number }) => {
      const chatPath = roomPath(slug, 'chat.md');
      if (!existsSync(chatPath)) throw new Error(`Room not found: ${slug}`);
      const content = readFileSync(chatPath, 'utf-8');
      const messages = parseMessages(content);
      const result =
        tail && tail > 0 ? messages.slice(-tail) : messages;
      return { slug, total: messages.length, messages: result };
    },
  },

  chat_read_unread: {
    description:
      '[Messaging] Return messages posted AFTER the last message written by `author` — i.e. what this author has not yet seen/replied to.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        author: {
          type: 'string',
          description:
            'The author whose perspective we take. Returns messages from others posted after this author\'s last post.',
        },
      },
      required: ['slug', 'author'],
    },
    handler: async ({ slug, author }: { slug: string; author: string }) => {
      const chatPath = roomPath(slug, 'chat.md');
      if (!existsSync(chatPath)) throw new Error(`Room not found: ${slug}`);
      const content = readFileSync(chatPath, 'utf-8');
      const messages = parseMessages(content);
      let lastOwnIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].author === author) {
          lastOwnIdx = i;
          break;
        }
      }
      const unread = messages.slice(lastOwnIdx + 1).filter((m) => m.author !== author);
      return {
        slug,
        author,
        unread_count: unread.length,
        messages: unread,
      };
    },
  },
};
