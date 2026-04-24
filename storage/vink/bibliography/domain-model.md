# Modelo de Dominio — Vink

## Flujo de valor principal

```
Cliente visita vinkcol.shop
        ↓
Navega catálogo (API pública ERP → ecommerce_sites / products)
        ↓
Agrega al carrito (CartContext local en Next.js)
        ↓
Checkout → Pedido creado (sales.sales)
        ↓
Confirmación → Shipment creado (logistics.shipments)
        ↓
Entrega → Settlement contable automático (accounting.sale_settlements)
```

## Entidades y schemas PostgreSQL

| Entidad | Schema.Tabla | Descripción |
|---|---|---|
| Sitio ecommerce | `ecommerce.ecommerce_sites` | Configuración de la tienda Vink |
| Productos publicados | `ecommerce.ecommerce_products` | Catálogo visible en la tienda |
| Colecciones | `ecommerce.ecommerce_collections` | Agrupaciones de productos |
| API Key ecommerce | `security.ecommerce_api_keys` | Autenticación de la tienda al ERP |
| Pedidos | `sales.sales` | Órdenes de compra |
| Envíos | `logistics.shipments` | Gestión logística por pedido |
| Clientes | `customers.customers` | Base de clientes |
| Productos (inventario) | `products.products` | Catálogo interno con stock |
| Movimientos contables | `accounting.accounting_movements` | Asientos por venta/entrega |

## Roles en el sistema

| Rol | Responsabilidad |
|---|---|
| `COMPANY_ADMIN` | Administrador de Vink — gestión completa del ERP |
| `COMPANY_SELLER` | Vendedor — POS y ventas |
| `COMPANY_LOGISTICS` | Operador logístico — envíos |

## Integraciones

| Sistema | Estado | Descripción |
|---|---|---|
| Next.js frontend | Activo | vink-shop en localhost:3002 (dev) / vinkcol.shop (prod) |
| Novalogic ERP API | Activo | Puerto 5007 (prod) / 3005 (dev) |
| Domiflash | Pendiente | Transportadora principal |
| Pagos (Wompi / Addi / Sistecredito) | Planificado | Ver docs/integracion-pagos |
