# Vink — Tenant Workspace

Tenant: **Vink SAS** (marca **Vink Shop**) · CompanyId Novalogic: `1c074a2c-5ae8-4d0f-9211-1bbb95faf9a9`

**Rol**: Tienda virtual propia de Novalogic — ingreso paralelo + cliente piloto del ERP.

## Quick start

- `context.md` — briefing del negocio, identidad, rol estratégico y credenciales
- `bibliography/` — documentación estructurada (glosario, modelo de dominio, data-lineage)
- `flows/` — workflows declarativos (operaciones, contabilidad, e-commerce)
- `mappings/` — diccionarios de datos
- `rules/` — reglas de negocio (envíos, precios, inventario)
- `datasets/` — archivos de datos organizados por dominio/año
- `reports/` — reportes generados

## Cómo explorar

1. **¿Qué es Vink?** → `context.md`
2. **¿Términos específicos?** → `bibliography/glossary.md`
3. **¿Modelo de dominio?** → `bibliography/domain-model.md`
4. **¿De dónde vienen los datos?** → `bibliography/data-lineage.md`
5. **¿Qué flujos existen?** → `flows/`

## Stack técnico

| Capa | Tecnología |
|---|---|
| ERP | Novalogic (NestJS + PostgreSQL) |
| E-commerce | Next.js 16 (App Router) + Redux Saga |
| Base de datos | PostgreSQL `novalogic_erp_n` (schema `ecommerce`, `sales`, `logistics`) |
| Storage | Local / MinIO |
| Despliegue | vinkcol.shop |

## Ecommerce

- **Frontend**: `projects/simora/magibell/ecommerce/vink-shop/`
- **API pública**: `http://localhost:5007/api/v1/public/ecommerce`
- **API Key**: `fe5a0f68-b3d8-4d5c-b4f8-5670166e90f1`
