# Data Lineage — Vink

## Fuentes de datos

| Fuente | Descripción | Acceso |
|---|---|---|
| Novalogic ERP API pública | Productos, categorías, colecciones para la tienda | `GET /api/v1/public/ecommerce/*` con `X-API-Key` |
| Novalogic ERP (interno) | Pedidos, clientes, inventario, contabilidad | Internal API con scopes |
| Next.js (frontend) | Carrito, sesión, estado de UI | CartContext / Redux local |

## Flujo de datos e-commerce

```
ERP (productos activos)
    → API pública /ecommerce/products
    → Next.js proxy /api/products
    → Redux store (productsSlice)
    → ProductGrid / ProductCard

Cliente hace checkout
    → Next.js /api/orders (POST)
    → ERP POST /api/v1/sales
    → sales.sales (DB)
    → Trigger: shipment creation (logistics.shipments)
    → Trigger: accounting movement
```

## Base de datos

- **DB principal**: `novalogic_erp_n` en `novalogic-postgres-n` (puerto 5436 local)
- **Schemas relevantes**: `ecommerce`, `sales`, `logistics`, `customers`, `accounting`, `security`

## Ecommerce API Key

La tienda Next.js se autentica contra el ERP usando:
- Header: `X-API-Key: fe5a0f68-b3d8-4d5c-b4f8-5670166e90f1`
- Tabla: `security.ecommerce_api_keys`
- Guard: `EcommerceApiKeyGuard` (SHA-256 hash, scope `ecommerce:*`)

## Estado actual (2026-04-18)

- Sitio ecommerce creado en DB (ID: `6066f4ec-ac50-416e-a373-c444ca1277a8`)
- API Key generada y activa
- Frontend instanciado y corriendo en `localhost:3002`
- Productos: pendiente de cargar al catálogo ERP
- Pedidos: sin historial aún (tienda nueva)
