import { join } from 'path';

export const PROJECT_ROOT = process.env.NOVALOGIC_PROJECT_ROOT || '';
export const API_SRC = join(PROJECT_ROOT, 'api', 'src');
export const DASH_SRC = join(PROJECT_ROOT, 'dashboard', 'src');
export const MCP_ROOT = join(PROJECT_ROOT, 'novalogic-mcp');
