# Folder Handles — OneDrive Simora

Catálogo legible de los IDs de carpeta anclados en `integrations/microsoft.json`. Consulta canónica: usa los handles por nombre, no el GUID.

## Drive principal

- **Drive ID:** `b!Mn6lOSktdkC8qVfqKQOcWUgCs0Aq_Z5Mk3RgawrWHexlIZP2NOQwQ5t-wscsOCTx`
- **Propietario:** `info@simora.co`
- **Root item:** `01NXFPQLN6Y2GOVW7725BZO354PWSELRRZ`

## Accounting

| Handle | Carpeta | OneDrive ID |
|---|---|---|
| `area_contabilidad_root` | CONTROL INTERNO/Área_Contabilidad | `01NXFPQLIPZW4FQV573RDYVIRATM5BDZEP` |
| `extractos_simora_root` | .../Extractos Simora | `01NXFPQLJI43O5IJB2ONGIZRTDNSV2PK2D` |
| `extractos_2023` | .../Extractos Simora/2023 | `01NXFPQLM4VAAAHKG7ONGK3LYS465YPNRY` |
| `extractos_2024` | .../Extractos Simora/2024 | `01NXFPQLKUFVE6ESLJJZDIJZ2KXCFMCLR5` |
| `extractos_2025` | .../Extractos Simora/2025 | `01NXFPQLOZ7X57SZ7KSBEZGPPGJOAVEVPG` |
| `registro_transferencias` | .../Registro de Transferencias | `01NXFPQLK7DLKGY43LNZF2USUB7UPQNQ4V` |
| `estado_cuenta_2025` | CONTABILIDAD ESTADO DE CUENTA 2025 | `01NXFPQLLLTF6VS2ZFNRHZPW7DVMNRUZ37` |
| `gestion_compras` | .../Gestión de Compras | `01NXFPQLKSIYUQ2MHCJFA3G3OL6DPR4QR5` |
| `documentos_fiscales_tributarios` | .../Documentos Fiscales y Tributarios | `01NXFPQLPXFPVUNDFO55GZMYXLRLW6SMKN` |
| `seguridad_social` | .../Seguridad social | `01NXFPQLMIHQHVEWLOOZBLC5KIMUWZVFMS` |
| `pagos_oficina` | .../Pagos oficina | `01NXFPQLILNKB3IKO3MNHISTDDVYSUCYRA` |
| `ctas_nomina` | .../Ctas. de Nómina | `01NXFPQLKBJ5XJY4E7MVHJLWXYO7AAZ5NW` |

## Logistics

| Handle | Carpeta | OneDrive ID |
|---|---|---|
| `area_logistica_root` | CONTROL INTERNO/Área_Logística Simora | `01NXFPQLKHJNHRF2GOBVC3C4CH6MXREP2Z` |
| `formatos` | .../0. Formatos | `01NXFPQLKBZWFLECRLGJFLQT47WNMPNS2R` |
| `control_interno` | .../1. Control Interno | `01NXFPQLKTNIR34M6EO5AY345RQPGVWTGD` |
| `control_servicio_logistico` | .../2. Control Servicio Logistico | `01NXFPQLKG2MP5MAXDWBC3LUN4NXTROMPA` |
| `courier_distribucion_domiflash` | .../1. Distribución Local - Domiflash | `01NXFPQLNIERFPHRRJ2FAIL5DBVZZ7GH7I` |
| `courier_reportes_domiflash` | .../2. Reportes Local - Domiflash | `01NXFPQLLGBCPOMRNMEBA2AP6PULYEJKSW` |
| `distribucion` | .../1. Control Interno/0. Distribución | `01NXFPQLOT65AQX3ZH2ZF3U32C3EHYG2IG` |
| `seguimiento_enrutamiento` | .../1. Seguimiento Enrutamiento | `01NXFPQLNTTLDIB6MV2FBIDMEWZK4LLTD4` |
| `control_paqueteria` | .../2. Control Paquetería | `01NXFPQLMCBYVT5KKSTJCZBUPUJ4MT6V2K` |
| `seguimiento_novedades` | .../3. Seguimiento Novedades | `01NXFPQLLLNCNAO43P5WJFIFDLWDULJKZP7` |
| `analisis_logistico` | .../4. Análisis Logístico | `01NXFPQLLHWEL5VO7QZJAJ5ES3QDBVYUDH` |
| `tarifas_envio` | .../5. Tarifas de Envío | `01NXFPQLNUHZDYXAJCDJEIK4CTP3IX5P2T` |
| `registro_planillas_diarias` | .../6. Registro Planillas Diarias | `01NXFPQLLGHW3JB6MC5RAZTZ4XT4EDTLBW` |

## Business (CONTROL INTERNO áreas top-level)

| Handle | Carpeta | OneDrive ID |
|---|---|---|
| `control_interno_root` | CONTROL INTERNO | `01NXFPQLIM2L4OQ3JRG5FYBGA4NSNZU7NU` |
| `area_ventas` | .../Área_Ventas Simora | `01NXFPQLJPF2P43XKQT5CZTCJVFHNJKHLX` |
| `area_produccion` | .../Área_Producción Simora | `01NXFPQLJYMNQMCGL435GLV34IVS3URBOZ` |
| `area_marketing` | .../Área_Marketing | `01NXFPQLPQ7J5YCGU5E5CLULSHBREPPTWJ` |
| `area_diseno` | .../Área_Diseño Simora | `01NXFPQLKE6OOWQVNU5JAYL24DRMVGFLRW` |
| `area_recursos_humanos` | .../Área_ Recursos Humanos Simora | `01NXFPQLKRLW4BYZKHEZGLPUPZDJ5L6RBR` |
| `documentos_simora` | .../Documentos Simora | `01NXFPQLO7MQ2UDFCXXRGJJ74JDN5E3KYR` |

## Cómo agregar handles

1. Identificar el folder en `graph_nodes` del grafo `simora-onedrive`.
2. Extender `integrations/microsoft.json` con un entry en la sección correspondiente.
3. Actualizar esta tabla.
4. (Opcional) Agregar un mapping en `simora.folder_mapping` si la carpeta participa en ETL.
