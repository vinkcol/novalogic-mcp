# Tenant Storage — Estructura Canónica

Cada empresa tiene una carpeta `storage/<slug>/` con lógica idiosincrática (no pertenece al core Novalogic). El agente MCP accede vía tools con prefijo `tenant_`.

## Layout por tenant

```
storage/<slug>/
  context.md            # Briefing del negocio — leído por tenant_context_get
  flows/
    <flow-name>.json    # Definiciones declarativas de casos de uso
  mappings/
    <mapping-name>.json # Diccionarios clave→valor (plan de cuentas, aliases, etc.)
  rules/
    <rule-name>.json    # Reglas de negocio estructuradas
  datasets/
    <file>              # Archivos crudos subidos por el cliente (CSV/XLSX/JSON)
  reports/
    <name>.md           # Outputs generados por flows
  integrations/
    <provider>.json     # Metadata de integración OAuth (Microsoft, Google...) — NUNCA secrets ni tokens
```

## Convenciones

- **Slug**: `[a-z0-9-]+` (ej. `simora`, `domiflash`).
- **Nombre de archivo**: `[a-z0-9-_]+` sin extensión al referenciarlos desde tools.
- **JSON siempre con `_meta`** cuando el archivo es un mapping/rule: `{ description, updated_at }`.
- **Los flows NO se auto-ejecutan**: el agente los lee con `tenant_flow_get` y ejecuta cada step manualmente. Esto aprovecha la orquestación nativa del LLM.
- **Referencias inter-step** dentro de un flow: `{{inputs.x}}`, `{{<saveAs>.<campo>}}` (por convención; el agente resuelve al ejecutar).

## Esquema canónico de un `flow.json`

```json
{
  "description": "Qué hace este flujo en una línea",
  "domain": "accounting | logistics | inventory | sales | ...",
  "owner": "quién lo pidió / contacto",
  "inputs": {
    "<paramName>": "descripción del parámetro que el agente debe pedir al usuario"
  },
  "preconditions": [
    "Requisitos previos (ej. 'dataset del mes cargado en datasets/')"
  ],
  "steps": [
    {
      "tool": "<nombre-de-tool-mcp>",
      "args": { "<arg>": "<valor o {{referencia}}>" },
      "saveAs": "<alias>",
      "note": "opcional — descripción si el step es manual (reasoning del LLM)"
    }
  ],
  "output": {
    "type": "report | mapping | side-effect",
    "target": "reports/<nombre>.md"
  },
  "tags": ["mensajería", "conciliación"]
}
```

## Esquema canónico de un `mapping.json`

```json
{
  "_meta": {
    "description": "Qué representa este mapping",
    "updated_at": "YYYY-MM-DD",
    "source": "de dónde vino la data (ej. 'entregado por contador')"
  },
  "<clave1>": "<valor1>",
  "<clave2>": { "id": "...", "extra": "..." }
}
```

## Esquema canónico de un `rules.json`

```json
{
  "description": "Qué regla de negocio modela",
  "updated_at": "YYYY-MM-DD",
  "<campo-libre>": "..."
}
```

## Tools disponibles

| Área | Tools |
|------|-------|
| Tenant | `tenant_list`, `tenant_init`, `tenant_context_get`, `tenant_context_save` |
| Flows | `tenant_flow_list`, `tenant_flow_get`, `tenant_flow_save`, `tenant_flow_delete` |
| Mappings | `tenant_mapping_list`, `tenant_mapping_get`, `tenant_mapping_upsert`, `tenant_mapping_lookup` |
| Rules | `tenant_rules_get`, `tenant_rules_save` |
| Datasets | `tenant_dataset_list`, `tenant_dataset_read`, `tenant_dataset_read_excel` |
| Integrations | `tenant_integration_list`, `tenant_integration_get`, `tenant_integration_save` |
| Reports | `tenant_report_save`, `tenant_report_list` |

## Agregar un tenant nuevo

1. Llamar `tenant_init({ slug, context })` — crea carpetas + `context.md`.
2. Registrar primer flow con `tenant_flow_save`.
3. (Opcional) poblar mappings y rules.

## Casos de uso registrados

Ver carpeta de cada tenant. Para Simora: [`storage/simora/flows/`](./simora/flows/).
