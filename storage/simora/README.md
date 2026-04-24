# Simora — Tenant Workspace

Tenant: **Simora SAS BIC** (marca **Magibell**) · CompanyId Novalogic: `2af87e54-33a6-4a60-9b88-63582d3edacb`

## Quick start

- `context.md` — briefing del negocio y particularidades
- `bibliography/` — documentación estructurada (glosario, data-lineage, modelo de dominio)
- `integrations/` — conectores externos (Microsoft Graph)
- `flows/` — workflows declarativos (auditoría, conciliación, export contable)
- `mappings/` — diccionarios (plan de cuentas, aliases)
- `rules/` — reglas de negocio
- `datasets/` — archivos originales descargados de OneDrive, organizados por dominio/año
- `reports/` — markdown generados por flows de auditoría

## Cómo explorar

1. **¿Qué es Simora?** → `context.md`
2. **¿Términos específicos?** → `bibliography/glossary.md`
3. **¿De dónde viene cada dato?** → `bibliography/data-lineage.md`
4. **¿Qué flujos existen?** → `flows/` + `bibliography/domain-model.md`
5. **¿Dónde viven los archivos Excel/PDF?** → `datasets/`
6. **¿Qué handles usa la integración Microsoft?** → `bibliography/folder-handles.md`

## Base de datos estructurada

Schema PostgreSQL `simora` en MCP DB (`novalogic-mcp-db:5433`). Ver `bibliography/data-lineage.md` para schema + ingesta.
