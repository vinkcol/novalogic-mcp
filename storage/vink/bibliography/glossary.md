# Glosario — Vink

## Entidades principales

| Término | Definición |
|---|---|
| **Vink** | Marca comercial de la tienda virtual. Propietario: Novalogic. |
| **Vink Shop** | Nombre legal / nombre del sitio ecommerce en el ERP |
| **Tienda** | El frontend Next.js en `vink-shop/` que consume la API pública del ERP |
| **ERP** | Novalogic — gestiona productos, inventario, ventas, envíos y contabilidad de Vink |
| **Pedido** | Orden de compra creada en el e-commerce (fluye a `sales.sales`) |
| **Envío** | Shipment creado en logística tras confirmación del pedido |
| **Guía** | Número de tracking asignado por la transportadora |

## Canales de venta

| Canal | Descripción |
|---|---|
| **E-commerce** | Tienda Next.js en vinkcol.shop — canal principal |
| **POS** | Punto de venta físico en el ERP — canal secundario |

## Módulos ERP usados

| Módulo | Uso en Vink |
|---|---|
| `products` | Catálogo de productos publicados en la tienda |
| `inventory` | Stock disponible por producto |
| `ecommerce` | Sitio virtual, colecciones, productos publicados |
| `sales` / `pos` | Gestión de pedidos y ventas |
| `shipping` | Logística y envíos |
| `customers` | Base de clientes |
| `accounting` | Asientos contables automáticos por venta/entrega |
| `analytics` | Métricas de ventas y rendimiento |

## Identificadores clave

| Identificador | Valor |
|---|---|
| CompanyId | `1c074a2c-5ae8-4d0f-9211-1bbb95faf9a9` |
| Ecommerce Site ID | `6066f4ec-ac50-416e-a373-c444ca1277a8` |
| Ecommerce API Key | `fe5a0f68-b3d8-4d5c-b4f8-5670166e90f1` |
