/**
 * Project context constants and helpers.
 * Used by tools to understand the Novalogic project structure.
 */

export const NOVALOGIC_DOMAINS = [
  'accounting', 'admin', 'ai', 'analytics', 'billing', 'company-users',
  'customers', 'files', 'finance', 'inventory', 'locations', 'metrics',
  'payments', 'plans', 'pos_legacy', 'products', 'profit-calculation',
  'sales-goals', 'sales-supervisor', 'shipping', 'staff', 'suppliers',
  'system-settings', 'virtual-store',
] as const;

export const DASHBOARD_FEATURES = [
  'Company', 'CompanyAdmin', 'CompanyCustomers', 'CompanyDashboard',
  'CompanyLogistic', 'CompanyManager', 'CompanyPOS', 'CompanyProducts',
  'CompanySales', 'CompanySeller', 'CompanySupervisor', 'CompanyStaff',
  'CompanyUsers', 'CompanyVirtualStore', 'Help', 'Locations',
  'Profile', 'Reports', 'Security', 'SystemAdmin',
] as const;

export const DISABLED_FEATURES = [
  'CompanyInventory.disabled',
  'CompanyShipping.disabled',
  'CompanySuppliers.disabled',
] as const;

export const DOMAIN_TO_FEATURE_MAP: Record<string, string[]> = {
  'shipping': ['CompanyLogistic', 'CompanyShipping.disabled'],
  'pos_legacy': ['CompanyPOS', 'CompanySales'],
  'staff': ['CompanyStaff'],
  'admin': ['Company', 'CompanyAdmin', 'SystemAdmin'],
  'customers': ['CompanyCustomers'],
  'products': ['CompanyProducts'],
  'inventory': ['CompanyInventory.disabled'],
  'suppliers': ['CompanySuppliers.disabled'],
  'virtual-store': ['CompanyVirtualStore'],
  'company-users': ['CompanyUsers'],
  'sales-supervisor': ['CompanySupervisor'],
  'locations': ['Locations'],
};

export const USER_ROLES = [
  'SYSTEM_ADMIN',
  'COMPANY_ADMIN',
  'COMPANY_SELLER',
  'COMPANY_LOGISTICS',
  'COMPANY_SALES_SUPERVISOR',
] as const;

export const API_PATH_ALIASES: Record<string, string> = {
  '@core': 'src/core/',
  '@admin': 'src/modules/system-settings/',
  '@shipping': 'src/modules/shipping/',
  '@staff': 'src/modules/staff/',
  '@ai': 'src/modules/ai/',
  '@company': 'src/modules/company/',
  '@pos': 'src/modules/pos_legacy/',
};

export const TECH_STACK = {
  api: {
    framework: 'NestJS 11',
    language: 'TypeScript 5.7',
    orm: 'TypeORM 0.3',
    database: 'PostgreSQL',
    auth: 'Passport JWT',
    docs: 'Swagger/OpenAPI',
    websocket: 'Socket.io',
    email: 'Nodemailer',
    storage: 'Cloudinary',
    excel: 'ExcelJS',
  },
  dashboard: {
    framework: 'React 18',
    language: 'TypeScript 5.2',
    bundler: 'Vite 5 + SWC',
    state: 'Redux Toolkit + Redux-Saga',
    ui: ['MUI v5', 'Radix UI', 'Tailwind CSS v4', 'styled-components'],
    forms: 'Formik + Yup',
    tables: 'MUI X Data Grid v6',
    auth: 'Keycloak',
    realtime: ['Socket.io', 'SignalR'],
    http: 'Axios',
    routing: 'React Router v6',
  },
};
