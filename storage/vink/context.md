# Vink — Contexto de negocio

Vink es un **piloto de tienda virtual de productos para mascotas**, propiedad de Novalogic. Funciona como ingreso paralelo para financiar Novalogic y como cliente real del ERP — validando el producto en producción.

## Identidad

- **Razón social**: Vink SAS
- **Marca comercial**: Vink / Vink Shop
- **CompanyId Novalogic**: `1c074a2c-5ae8-4d0f-9211-1bbb95faf9a9`
- **Dominio**: https://vinkcol.shop
- **Email admin**: admin@vinkcol.shop
- **Teléfono**: 3204571674
- **Plan**: Plan Vitalicio (lifetime) — todos los módulos habilitados
- **Moneda**: COP · Locale: es-CO · Timezone: America/Bogota

## Rol estratégico

1. **Ingreso paralelo**: Vink financia a Novalogic con revenue de e-commerce propio
2. **Cliente piloto real**: usa Novalogic como sistema operativo — POS, inventario, logística, ecommerce, contabilidad
3. **Validación de producto**: cada fricción operativa de Vink → mejora del ERP
4. **Caso de éxito demostrable**: ROAS probado de $60k COP en Facebook → 4 ventas en un día

## Catálogo actual

| Producto | Stock | Estado |
|---|---|---|
| Cepillo para pelos de mascotas (tipo A) | 1 unidad restante (vendió 4 en 1 día) | Activo — alta rotación |
| Cepillo para pelos de mascotas (tipo B) | 5 unidades | Activo |

- **Categoría**: Productos para mascotas (pet care)
- **Rotación**: Altísima — agotó casi todo el stock del producto A en un día con $60k COP en Facebook Ads
- **Todo el proceso actual es manual** — objetivo: automatizarlo completamente con Novalogic

## Ecommerce

- **Sitio ID**: `6066f4ec-ac50-416e-a373-c444ca1277a8`
- **Slug**: `vink-shop` · Tipo: CATALOG
- **API Key pública (ecommerce)**: `fe5a0f68-b3d8-4d5c-b4f8-5670166e90f1`
- **API Key interna MCP (vink-mcp)**: `nk_8c5d6082cb0bc17d34eba496a1cfcfc457515fc3` · prefix: `nk_8c5d6` · scopes: products:*, inventory:*, sales:read, ecommerce:read, customers:*, accounting:read
- **Frontend Next.js**: `projects/simora/magibell/ecommerce/vink-shop/`
- **Dev server**: `http://localhost:3002`
- **API ERP local**: `http://localhost:5007/api/v1/public/ecommerce`

## Canales de adquisición probados

| Canal | Inversión | Resultado | Fecha |
|---|---|---|---|
| Facebook Ads | $60,000 COP | 4 ventas en 1 día | 2026-04 |

## Visión operativa

Usar **Novalogic como el sistema operativo de Vink**:
- Inventario y productos en ERP
- Pedidos desde tienda → automáticamente en ERP
- Logística automatizada (creación de envíos, notificaciones)
- Contabilidad automática por entrega
- Analytics para optimizar inversión en ads
- Sin operación manual

## Módulos ERP activos

`pos`, `sales`, `products`, `inventory`, `shipping`, `customers`, `ecommerce`, `accounting`, `finance`, `analytics`, `ai`, `staff`, `reports`, `api_access`

## Estado actual (2026-04-18)

- Sitio ecommerce creado en DB y API key activa
- Frontend Next.js instanciado en localhost:3002
- 2 productos en catálogo, stock limitado (piloto)
- 4 ventas realizadas manualmente — validación exitosa del mercado
- Estrategia de difusión y automatización: **por construir**
