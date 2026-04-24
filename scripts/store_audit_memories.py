"""Store project audit memories in MCP DB with Ollama embeddings."""
import json
import requests
import psycopg2

OLLAMA_URL = "http://localhost:11434/api/embeddings"
EMBEDDING_MODEL = "nomic-embed-text"

DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "dbname": "novalogic_mcp",
    "user": "novalogic",
    "password": "novalogic_mcp_2024",
}

MEMORIES = [
    {
        "agent": "librarian",
        "category": "architecture",
        "title": "API Core Infrastructure",
        "content": (
            "NestJS API core at api/src/core/ has 69 files: security(31 files - auth, JWT, users, roles, permissions), "
            "database(5 - TypeORM config, data-source, soft-delete, tenant repo, transactions), "
            "guards(5 - jwt-auth, roles, permissions, tenant, ecommerce-api-key), "
            "interceptors(4 - response, tenant, logging, transform), filters(1 - global exception), "
            "files(2 - Cloudinary), excel(2 - ExcelJS), mail(1 - Nodemailer), hubs(2 - Socket.io), "
            "logging(1 - Winston), time(3 - timezone), decorators(1)"
        ),
        "tags": ["api", "core", "infrastructure", "security", "database", "guards"],
    },
    {
        "agent": "librarian",
        "category": "architecture",
        "title": "API Domain Modules Overview",
        "content": (
            "24 NestJS domain modules at api/src/modules/ totaling ~287 files. "
            "Largest: ai(56 files - agent orchestrator, 4 providers, knowledge graph), "
            "pos_legacy(24 - POS/sales with 13 DTOs), shipping(23 - 5 controllers, 8 models), "
            "products(19), analytics(18), admin(18). Each follows: module.ts + controllers/ + services/ + "
            "repositories/ + models/ + dto/. Path aliases: @core, @admin, @shipping, @staff, @ai, @company, @pos"
        ),
        "tags": ["api", "modules", "domain", "nestjs"],
    },
    {
        "agent": "librarian",
        "category": "architecture",
        "title": "Dashboard Shared Components",
        "content": (
            "Dashboard shared UI at dashboard/src/components/: layout(atoms 7, molecules 9, organisms 11, "
            "templates 3 + TemplateLayout), ui(27 Shadcn/Radix components), fields(22 form fields), "
            "forms(FormSection), error(ErrorBoundary), debug(DebugConsole/Panel), pages(NotFoundPage), "
            "performance(LazyImage, VirtualizedList), permissions(PermissionGuard), seo(HelmetConfig), "
            "tables(DataTable). Hooks: useDebounce, useLocationData, usePermission, useTableData/Search/Sort"
        ),
        "tags": ["dashboard", "components", "shared", "ui"],
    },
    {
        "agent": "librarian",
        "category": "architecture",
        "title": "Dashboard Features Inventory",
        "content": (
            "20 active features + 3 disabled at dashboard/src/features/. "
            "Largest by Redux: SystemAdmin(19 slices, 12 pages, 6 APIs), CompanyProducts(10 redux, 5 pages, 3 APIs), "
            "CompanySupervisor(7 redux, 6 pages, 5 APIs), CompanyAdmin(7 redux). "
            "Each feature has: pages/, components/, hooks/, api/, redux/, layouts/, types/. "
            "Disabled: CompanyInventory, CompanyShipping, CompanySuppliers (suffixed .disabled)"
        ),
        "tags": ["dashboard", "features", "react", "redux"],
    },
    {
        "agent": "librarian",
        "category": "architecture",
        "title": "API Module Dependency Graph",
        "content": (
            "SalesModule is central hub: depends on InventoryModule, ProductsModule, CustomersModule, "
            "PaymentsModule(forwardRef circular), LogisticsModule, EmployeesModule, SecurityModule. "
            "AIModule depends on SalesModule, SalesGoalsModule, AnalyticsModule, InventoryModule. "
            "LogisticsModule depends on LocationsModule, SecurityModule, AccountingModule. "
            "InventoryModule depends on ProductsModule. ProductsModule depends on CompanyModule. "
            "8 modules isolated: Accounting, Billing, Finance, Plans, SalesGoals, SalesSupervisor, Suppliers, SystemSettings. "
            "Dependency tiers: Tier0(Core) -> Tier1(Base: Company,Locations) -> Tier2(Domain: Products,Customers,Employees) "
            "-> Tier3(Complex: Inventory,Logistics,Payments) -> Tier4(Hubs: Sales,AI) -> Tier5(Analytics,Metrics,Profit)"
        ),
        "tags": ["api", "dependencies", "graph", "modules"],
    },
    {
        "agent": "librarian",
        "category": "architecture",
        "title": "Dashboard Feature Dependency Graph",
        "content": (
            "Security feature is hub with 16 dependents. CompanyPOS has 6 outgoing deps: CompanyAdmin, "
            "CompanyCustomers, CompanyProducts, CompanyVirtualStore, Locations, Security. "
            "CompanySales has 6 deps: CompanyAdmin, CompanyLogistic, CompanyStaff, CompanyUsers, Locations, Security. "
            "8 leaf features with no dependents: Company, CompanyDashboard, CompanyCustomers, CompanyManager, "
            "Help, Locations, Profile, Reports. Room access: SYSTEM_ADMIN(all), COMPANY_ADMIN(all empresa), "
            "COMPANY_SELLER(ventas,clientes,productos), COMPANY_LOGISTICS(logistica,ventas,productos), "
            "COMPANY_SALES_SUPERVISOR(supervisor,ventas,reportes). 23 Redux slices total."
        ),
        "tags": ["dashboard", "dependencies", "graph", "features", "rooms"],
    },
    {
        "agent": "librarian",
        "category": "config",
        "title": "MCP Embedding System - Ollama Integration",
        "content": (
            "MCP vector-store upgraded from simple character n-gram hash (384 dims) to Ollama nomic-embed-text (768 dims). "
            "Changes: vector-store.ts calls Ollama API at localhost:11434/api/embeddings with fallback to hash. "
            "DB schema updated: memories and context_snapshots tables use vector(768). "
            "Config in .mcp.json env: OLLAMA_BASE_URL=http://localhost:11434, EMBEDDING_MODEL=nomic-embed-text. "
            "Build: npm run build in novalogic-mcp/. Ollama also has models: nexus-cortex, oculus-vision, cerebro-mcp, "
            "deepseek-coder-6.7b, Qwen3-8B-Q8_0 available for other tasks."
        ),
        "tags": ["mcp", "embeddings", "ollama", "vector", "upgrade"],
    },
    {
        "agent": "librarian",
        "category": "domain-knowledge",
        "title": "Project Statistics Summary",
        "content": (
            "Novalogic total: API ~367 files + Dashboard ~934 files = ~1301 source files. "
            "API: 24 domain modules, 35 controllers, 56 services, 48 repository pairs, 79 models, 110 DTOs, "
            "7 migrations, 69 core infrastructure files. "
            "Dashboard: 20 active + 3 disabled features, 23 Redux slices, 27 shared UI components, "
            "22 form field components, 9 shared hooks, 5 user roles, 9 room categories. "
            "Tech: NestJS 11 + TypeORM 0.3 + PostgreSQL (API), React 18 + Vite 5 + Redux Toolkit + MUI v5 + "
            "Radix UI + Tailwind v4 (Dashboard). Auth: JWT + Keycloak. Real-time: Socket.io + SignalR."
        ),
        "tags": ["project", "statistics", "overview", "summary"],
    },
]


def get_embedding(text: str) -> list[float]:
    """Get embedding from Ollama nomic-embed-text."""
    resp = requests.post(
        OLLAMA_URL,
        json={"model": EMBEDDING_MODEL, "prompt": text[:8192]},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def main():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    print(f"Connected to DB. Storing {len(MEMORIES)} memories with Ollama embeddings...\n")

    for i, mem in enumerate(MEMORIES, 1):
        try:
            text = f"{mem['title']} {mem['content']}"
            embedding = get_embedding(text)
            pg_vector = f"[{','.join(str(x) for x in embedding)}]"

            cur.execute(
                """INSERT INTO memories (agent, category, title, content, metadata, tags, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s::vector)
                   RETURNING id""",
                (
                    mem["agent"],
                    mem["category"],
                    mem["title"],
                    mem["content"],
                    json.dumps({}),
                    mem["tags"],
                    pg_vector,
                ),
            )
            mem_id = cur.fetchone()[0]
            conn.commit()
            print(f"  [{i}/{len(MEMORIES)}] OK (id={mem_id}): {mem['title']}")
        except Exception as e:
            conn.rollback()
            print(f"  [{i}/{len(MEMORIES)}] FAIL: {mem['title']} — {e}")

    # Verify
    cur.execute("SELECT count(*), array_agg(DISTINCT category) FROM memories")
    count, categories = cur.fetchone()
    print(f"\nTotal memories in DB: {count}")
    print(f"Categories: {categories}")

    # Test semantic search
    print("\n--- Testing semantic search: 'sales module dependencies' ---")
    test_emb = get_embedding("sales module dependencies")
    test_vec = f"[{','.join(str(x) for x in test_emb)}]"
    cur.execute(
        """SELECT id, title, 1 - (embedding <=> %s::vector) as similarity
           FROM memories ORDER BY embedding <=> %s::vector LIMIT 3""",
        (test_vec, test_vec),
    )
    for row in cur.fetchall():
        print(f"  id={row[0]} sim={row[2]:.4f} | {row[1]}")

    cur.close()
    conn.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
