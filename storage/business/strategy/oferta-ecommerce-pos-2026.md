# Oferta Comercial: Ecommerce + POS Digital — Novalogic 2026

> **Fecha:** 2026-05-12
> **Estado:** Propuesta inicial — pendiente validacion
> **Objetivo:** Definir paquete agresivo de entrada al mercado colombiano/LATAM con ecommerce + POS unificado

---

## 1. Analisis del Mercado

### Datos clave Colombia/LATAM
- **94% de penetracion WhatsApp** en Colombia, 90% lo usa diario
- **62% de clientes** prefieren consultar precios y disponibilidad por WhatsApp
- **85% de crecimiento** en transacciones completadas dentro de WhatsApp en LATAM (2025)
- Social commerce LATAM: **USD $14,600M** en 2025, creciendo 20% anual
- PSE representa **35% de transacciones** en Colombia

### Fuentes
- [WhatsApp ecommerce Colombia 2026](https://chatsell.net/whatsapp-business-ecommerce-colombia-automatizar-ventas-2026/)
- [Estadisticas WhatsApp LATAM](https://www.aurorainbox.com/en/2026/03/04/estadisticas-ecommerce-whatsapp-latam/)
- [Tendencias marketing digital Colombia 2026](https://www.workitd.com/tendencias-marketing-digital-colombia-2026/)

---

## 2. Analisis Competitivo

| Competidor | Precio base | Fortaleza | Debilidad que explotamos |
|---|---|---|---|
| **Treinta** | ~$25K COP/mo | Mobile-first POS, marca fuerte en Colombia | No tiene tienda web. Solo registra ventas, no genera ventas nuevas |
| **Alegra** | $25,900 COP/mo | Facturacion electronica DIAN | Enfocado en contabilidad, no en vender. POS basico, zero ecommerce |
| **Tiendanube** | Gratis-$60K COP/mo | Tienda bonita, marketplace apps | No tiene POS real. Si vendes por WhatsApp, registras manualmente |
| **Jumpseller** | ~$35K-$200K COP/mo | Multicanal | No unifica canales. WhatsApp es add-on, no nativo |
| **Shopify** | ~$80K+ COP/mo ($19 USD) | Ecosistema global | Caro, comisiones 2%, POS Pro aparte. Overkill para PYME colombiana |

### Fuentes competencia
- [Treinta planes](https://www.treinta.co/planes-y-precios)
- [Alegra POS precios](https://www.alegra.com/colombia/pos/precios/)
- [Tiendanube Colombia](https://www.tiendanube.com/blog/plataformas-para-vender-productos-en-colombia/)
- [Jumpseller vs Shopify vs Tiendanube](https://www.tiendanube.com/blog/jumpseller-vs-shopify/)

### La brecha que nadie cubre

**Ninguna plataforma en Colombia unifica POS + Tienda Web + WhatsApp en un solo lugar donde TODO llega al mismo panel.**

- Treinta registra pero no vende online
- Tiendanube vende online pero no registra WhatsApp
- Alegra factura pero no genera ventas
- Shopify hace todo pero cuesta un ojo y cobra comision

---

## 3. Posicionamiento

**"Tu negocio, un solo lugar. Vende por WhatsApp, por tu tienda web y en punto de venta — todo llega al mismo sitio."**

No somos una app de contabilidad. No somos solo una tienda online. Somos **el sistema de ventas completo** para negocios que venden por WhatsApp y quieren crecer.

---

## 4. Estructura de Planes

### GRATIS — "Arranca"
**$0/mes** — Sin tarjeta, para siempre

- POS virtual (registra ventas WhatsApp/presencial)
- 30 productos
- 50 pedidos/mes
- Catalogo web basico (tu-negocio.novalogic.co)
- 1 usuario
- Notificaciones WhatsApp (pedido recibido/listo)

**Justificacion:** Treinta es gratis. Si no arrancas gratis, no existes para el 80% del mercado. Este tier es puro embudo. Limite de 50 pedidos/mes se quema en ~2 semanas para un negocio activo en WhatsApp = upgrade natural.

---

### IMPULSO — $39,900/mes (~$10 USD)
*"Para los que ya venden todos los dias"*

- Todo lo gratis +
- 200 productos
- 500 pedidos/mes
- Checkout con pago (COD + transferencia + PSE via Wompi)
- Codigos de descuento
- Reportes de ventas basicos
- Dominio propio (tunegocio.com)
- 2 usuarios

**Justificacion:** Debajo de Treinta Pro (~$50K), debajo de Alegra Emprendedor ($25,900 pero sin tienda), debajo de Tiendanube pagos ($50K+). Precio psicologico "menos de $40 mil" — equivalente a una cena para dos.

**Diferenciador:** Nadie da POS + tienda web + checkout + WhatsApp por $40K.

---

### NEGOCIO — $79,900/mes (~$20 USD) >> PLAN RECOMENDADO
*"Para negocios serios"*

- Todo lo anterior +
- Productos ilimitados
- 2,000 pedidos/mes
- Pasarela de pagos completa (tarjetas + PSE + Nequi)
- Inventario
- Conexion Shopify (sincroniza productos/pedidos)
- API para tu propia tienda
- Reportes avanzados
- 5 usuarios
- Soporte prioritario

**Justificacion:** Money maker. Menos que Alegra Pyme ($79,900 sin tienda), menos que Shopify Basic ($80K+ sin POS). Captura negocio que factura $5-40M/mes. Ancla psicologica: 70%+ de usuarios pagos caen aqui.

---

### ESCALA — $149,900/mes (~$37 USD)
*"Para operaciones multicanal"*

- Todo lo anterior +
- Pedidos ilimitados
- Logistica y envios integrados
- Multiples puntos de venta
- Analytics e IA
- Contabilidad basica
- 15 usuarios
- API sin restricciones
- Soporte dedicado

**Justificacion:** Logistica es el upgrade premium natural. Quien necesita envios gestiona volumen real y paga feliz.

---

## 5. Arquitectura de Canales

```
                    +-------------------+
                    |   DASHBOARD       |
                    |   NOVALOGIC       |
                    |  (un solo lugar)  |
                    +---------+---------+
                              |
            +-----------------+-----------------+
            |                 |                 |
    +-------v------+  +------v-------+  +------v-------+
    |  POS Virtual |  | Tienda Web   |  |  Shopify /   |
    |  (WhatsApp)  |  | (Catalogo)   |  |  API propia  |
    |              |  |              |  |              |
    | Vendes por   |  | 3 opciones:  |  | Ya tienes    |
    | chat, llamas,|  | - Catalogo   |  | Shopify?     |
    | Instagram,   |  |   propio     |  | Conectala.   |
    | presencial   |  | - Plantilla  |  |              |
    | -> Registras |  |   generica   |  | Tienes dev?  |
    |   aqui       |  | - Dominio    |  | Usa la API.  |
    |              |  |   propio     |  |              |
    +--------------+  +--------------+  +--------------+
```

**Mensaje de venta:** "No importa como vendes hoy, todo llega al mismo panel."

---

## 6. Estrategia Go-To-Market (primeros 90 dias)

### Semana 1-2: Lanzamiento "Free Forever"
- Landing page directa: **"Registra tus ventas de WhatsApp gratis. Para siempre."**
- Target: Negocios que hoy venden por WhatsApp y anotan en un cuaderno o notas del celular
- Canal: Pauta en Instagram/Facebook -> Colombia, audiencia "duenos de negocio", "emprendedores", "tienda online"
- CTA: "Empieza en 2 minutos" (onboarding ultra simple)

### Semana 3-6: Contenido de conversion
- Comparativas directas: "Novalogic vs Treinta", "Novalogic vs Tiendanube"
- SEO: "como vender por WhatsApp", "sistema POS gratis Colombia", "tienda virtual gratis"
- Casos de uso: "Maria vendia por WhatsApp y anotaba en un cuaderno. Ahora factura $8M/mes desde un solo lugar."

### Semana 7-12: Upgrade engine
- Usuarios free acercandose al limite de 50 pedidos -> email/WhatsApp automatico: "Vas volando. Desbloquea pedidos ilimitados por $39,900/mes"
- Trial de 14 dias del plan Negocio para usuarios free activos
- Referidos: "Invita un negocio amigo, ambos reciben 1 mes de Impulso gratis"

---

## 7. Metricas Target

| Metrica | Target mes 3 | Target mes 6 |
|---|---|---|
| Registros free | 500 | 2,000 |
| Conversion free->pago | 8% | 12% |
| MRR | $5M COP | $25M COP |
| Churn mensual | <5% | <4% |
| ARPU | $60K COP | $70K COP |
| CAC (costo adquisicion) | <$15K COP | <$10K COP |

---

## 8. Ajustes de Producto Requeridos (minimo viable comercial)

1. **Plan Free real en produccion** — Hoy existe plan "Gratuito" con POS+Ventas+Clientes+50 productos. Falta catalogo web incluido en free.
2. **Onboarding de 2 minutos** — Registro -> crea negocio -> agrega primer producto -> comparte link de catalogo. Instantaneo.
3. **Link de catalogo compartible por WhatsApp** — "Mira mi catalogo: tunegocio.novalogic.co". El negocio lo manda en sus chats.
4. **Checkout simplificado** — COD + transferencia minimo en free. PSE/Wompi en pagos.
5. **Plantilla generica de tienda que funcione** — No tiene que ser bella, tiene que cargar rapido y convertir.

---

## 9. Pitch Resumen

### Tabla comparativa final

| Competidor | Ellos | Novalogic |
|---|---|---|
| Treinta | Registra ventas | Registra Y genera ventas (tienda + catalogo) |
| Tiendanube | Tienda web | Tienda web + POS + WhatsApp unificado |
| Alegra | Factura | Vende + factura + envia |
| Shopify | Todo pero caro ($80K+ + 2%) | Todo por $79,900, cero comision |

### Pitch en una linea

> *"Deja de anotar ventas en el cuaderno. Registra las de WhatsApp, abre tu tienda web y maneja todo en un solo lugar — gratis para empezar."*

---

## 10. Mapeo a Planes Actuales del Sistema

| Plan propuesto | Plan actual mas cercano | Accion |
|---|---|---|
| Gratis (Arranca) | Plan Gratuito (id:1) + Catalog Starter (id:9) | Fusionar: agregar catalogo web al free |
| Impulso $39,900 | Catalog Starter $29,900 (id:9) | Ajustar precio y features |
| Negocio $79,900 | Catalog Growth $59,900 (id:10) | Ajustar precio, agregar Shopify+API |
| Escala $149,900 | Catalog Pro $99,900 (id:11) / Plan Profesional $149,900 (id:3) | Mantener precio, unificar features |

> **Nota:** Los planes "Plan Basico" (id:2), "Plan Profesional" (id:3) y "Plan Empresarial" (id:4) son la estructura generica SaaS. Los planes "Catalog" (id:9-11) son especificos de ecommerce. La propuesta unifica ambas lineas en una sola oferta coherente.
