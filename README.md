# Sistema Operativo Digital de la Cooperativa — MVP

Sistema de gestión interno para una cooperativa de vivienda por ayuda mutua en Uruguay, con 5 módulos (Obra, Trabajo, Compras, Seguridad, Finanzas), Documentos, Dashboard, Alertas automáticas, Auditoría y un Asistente de IA. Construido según el análisis profesional previo (`Sistema_Operativo_Digital_Cooperativa_Analisis.docx`).

Es un prototipo funcional de alcance MVP: prioriza tener los cinco módulos funcionando de punta a punta con datos reales, antes que pulir cada detalle. La sección "Qué quedó afuera a propósito" explica los límites conscientes.

## Puesta en marcha local

Requisitos: Node.js 22+ y un proyecto de [Supabase](https://supabase.com) (Postgres). Ya NO usa SQLite — esa fue la base de datos de la primera versión del MVP, reemplazada por Postgres/Supabase.

```bash
npm install
# .env.local con DATABASE_URL, AUTH_SECRET y SETUP_SECRET (ver "Variables de entorno")
npm run migrate                              # crea la tabla organizations, organization_id y RLS
curl "http://localhost:3000/api/setup?key=$SETUP_SECRET"              # crea las tablas base
curl "http://localhost:3000/api/setup?key=$SETUP_SECRET&seed=demo"    # datos de ejemplo (solo si la cooperativa está vacía)
npm run dev       # http://localhost:3000
```

Al entrar redirige a `/login`. Ahí mismo hay un desplegable con los 11 usuarios de prueba, uno por rol. La contraseña de todos es:

```
cooperativa2026
```

Por ejemplo: `helena@coop.uy` (Consejo Directivo) ve todo; `ana@coop.uy` (Socia) ve una versión acotada; `beatriz@coop.uy` (Comisión de Obra) puede cargar tareas y avances.

**El sistema es multi-tenant**: cada cooperativa es una fila en `organizations` y ve solo sus propios datos (ver `migrations/README.md`). En desarrollo local, sin subdominios configurados, todo el tráfico se resuelve a la cooperativa `coova` por defecto (configurable con `NEXT_PUBLIC_DEFAULT_ORG_SLUG`).

## Qué incluye

- **Obra**: cronograma por etapas, semáforo automático (verde/amarillo/rojo) calculado por atraso y por problemas críticos abiertos, avances con foto, problemas/observaciones, dependencias simples entre tareas.
- **Trabajo**: calendario de jornadas de ayuda mutua, propuesta de distribución de tareas por núcleo familiar generada por un motor de reglas (habilidades registradas + disponibilidad), confirmación de asignaciones, registro de asistencia y horas acumuladas por núcleo.
- **Compras**: solicitudes de compra, carga de presupuestos de proveedores, comparación automática en lenguaje simple (precio, envío, plazo, forma de pago, garantía) que **nunca** elige por sí sola al proveedor, registro de la decisión y motivo, historial de proveedores.
- **Seguridad**: documentación con vencimientos y alertas, checklist de inspección, incidentes/observaciones con foto (con una nota de IA "asistencia preliminar" que siempre aclara que no reemplaza al responsable de seguridad).
- **Finanzas**: ingresos/egresos, distinción explícita entre saldo bancario y disponible prudencial (saldo − comprometido), gasto por categoría, presupuesto vs. real, próximos pagos. Los montos detallados solo los ve Administración, Tesorería, Consejo Directivo, Comisión Fiscal y el Administrador del sistema (los demás roles ven un resumen).
- **Documentos**: repositorio con categorías (actas, reglamentos, contratos, etc.), subida y descarga real de archivos.
- **Alertas**: motor de reglas que recalcula automáticamente alertas críticas/importantes/informativas a partir de los datos (documentos vencidos, tareas atrasadas, riesgos abiertos, desvíos de presupuesto, disponible prudencial negativo, tareas de jornada sin cubrir), asignadas a la comisión responsable.
- **Auditoría**: registro de solo lectura (no editable desde la aplicación) de compras, pagos, aprobaciones y otras acciones sensibles: quién, qué, cuándo, valor anterior y nuevo.
- **Roles y permisos**: 11 roles con una matriz de acceso por módulo (lectura / edición / aprobación / configuración), igual a la propuesta de la sección 7 del análisis.
- **Asistente de IA**: chat con preguntas sugeridas que lee los datos reales del sistema y cita la fuente. Funciona en dos modos (ver más abajo).

## El Asistente de IA: motor local vs. Claude real

Por decisión explícita al construir este MVP, el chat funciona **sin necesitar ninguna API key** todavía: un motor de reglas locales (`src/lib/ia.ts`) interpreta las preguntas frecuentes ("¿cómo viene la obra?", "¿qué tareas están atrasadas?", "¿cuánto dinero tenemos?", etc.) y arma la respuesta consultando la base de datos real, citando siempre el módulo de origen.

Cuando quieras respuestas más flexibles generadas por un modelo de lenguaje real:

1. Conseguí una API key en [console.anthropic.com](https://console.anthropic.com).
2. Agregala como variable de entorno `ANTHROPIC_API_KEY` (en `.env.local` para desarrollo, o en las variables de entorno de tu hosting en producción).
3. Reiniciá el servidor. El chat va a usar automáticamente Claude, pasándole como contexto los mismos datos que usa el motor local (obra, finanzas, compras pendientes, alertas), filtrados según el rol de quien pregunta. El resto del sistema no cambia.

En ningún modo la IA aprueba compras, pagos, ni decisiones — eso está impuesto a nivel de diseño (ver sección 17 del análisis), no solo de prompt.

## Arquitectura y por qué se eligió así

| Capa | Elección en este MVP | Nota |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Actions) | Un solo proyecto para frontend y backend. |
| Base de datos | PostgreSQL, vía Supabase | `pg` con SQL a mano, sin ORM. |
| Multi-tenant | Cada cooperativa es una fila en `organizations`; `organization_id` en cada tabla; Row-Level Security en Postgres | Ver `migrations/README.md` y `src/lib/tenant.ts`. |
| Autenticación | Cookie firmada (JWT con `jose`) + `bcryptjs` para contraseñas | La sesión incluye la cooperativa del usuario. Cambiá `AUTH_SECRET` en producción (ver más abajo). |
| Archivos subidos | Se guardan en `public/uploads/` | Pendiente de migrar a almacenamiento en la nube (Supabase Storage) — no funciona en hosting serverless sin disco persistente y no está aislado por cooperativa todavía. |
| Estilos | Tailwind CSS v4, mobile-first | Mismo diseño visual que el documento de análisis (semáforos, tarjetas, colores institucionales). |

Toda la lógica de acceso a datos pasa por `src/lib/db.ts` (funciones genéricas `all`, `get`, `insert`, `update`) y `src/lib/logic.ts` (semáforo, alertas, finanzas, comparación de compras). El resto de la aplicación (páginas y acciones) usa esas funciones, no SQL directo — es lo que permitió agregar el aislamiento multi-tenant sin reescribir cada página y cada Server Action.

## Variables de entorno

Creá un archivo `.env.local` (no se commitea):

```bash
DATABASE_URL=postgres://...        # connection string de Supabase
AUTH_SECRET=una-clave-larga-y-aleatoria-antes-de-produccion
SETUP_SECRET=otra-clave-para-proteger-/api/setup
ANTHROPIC_API_KEY=sk-ant-...        # opcional, activa el motor de IA con Claude real
NEXT_PUBLIC_DEFAULT_ORG_SLUG=coova  # cooperativa por defecto cuando no hay subdominio propio
```

Si no definís `AUTH_SECRET`, el sistema usa una clave de desarrollo solo en modo desarrollo — en producción, arranca sin sesión posible hasta que la definas (es intencional: firmar sesiones con un secreto compartido anularía el aislamiento entre cooperativas).

## Qué quedó afuera a propósito (Fase 2)

Siguiendo el roadmap del análisis (sección 20), este MVP no incluye todavía:

- Búsqueda semántica de la IA dentro de documentos largos (RAG) — hoy la IA responde sobre datos estructurados, no sobre el contenido libre de PDFs.
- Análisis automático de fotos de seguridad por IA (hoy deja una nota de "asistencia preliminar" fija, no analiza la imagen en sí).
- Permisos por documento individual dentro de "Documentos" (hoy el permiso es por módulo, no por categoría o documento específico — por ejemplo, "documentación de socios" debería tener un control más fino antes de un uso real).
- Notificaciones push/email automáticas de alertas (hoy las alertas se ven al entrar al sistema, no se envían solas).
- Reportes descargables (PDF/Excel) de resúmenes semanales o mensuales.

## Estructura del proyecto

```
src/
  app/                  páginas (App Router) y layout con navegación mobile-first
    (app)/              rutas protegidas por sesión: dashboard, obra, trabajo, compras...
    login/
  components/           componentes de UI reutilizables (Card, Badge, Nav, ChatIA...)
  proxy.ts              resuelve la cooperativa por subdominio (multi-tenant)
  lib/
    schema.postgres.sql  esquema base de datos (Postgres)
    db.ts                capa de acceso a datos (Postgres) + aislamiento multi-tenant + auditoría + alertas
    tenant.ts             contexto de cooperativa activa (multi-tenant)
    logic.ts              semáforo, finanzas, motor de comparación de compras, motor de alertas
    ia.ts                  motor de IA (local + Claude opcional)
    roles.ts               matriz de roles y permisos
    auth.ts                 sesión (cookie firmada) y hashing de contraseñas
    actions/                Server Actions por módulo (mutaciones)
migrations/             cambios de esquema versionados (multi-tenant) — ver migrations/README.md
scripts/
  run-migrations.mjs    aplica las migraciones pendientes
test-e2e.mjs            smoke test opcional con Playwright (ver abajo)
```

## Smoke test automático (opcional)

Hay un script de prueba end-to-end con Playwright que recorre los módulos con distintos roles, crea una tarea, carga una comparación de compras y consulta al asistente de IA, para detectar errores de un vistazo:

```bash
npx playwright install chromium   # una sola vez
npm run dev &                      # en otra terminal
node test-e2e.mjs
```

Termina con `ALL CHECKS PASSED` o una lista de errores concretos.

## Recordatorio de diseño (no técnico)

Este sistema es un asistente de organización, no un reemplazo de las personas ni de los profesionales responsables (IAT, contador, técnico prevencionista, escribano). Ninguna pantalla aprueba automáticamente una compra, un pago, una decisión técnica o una cuestión de seguridad: siempre queda un clic explícito de la persona u órgano con esa atribución. Para el detalle completo de qué es obligación legal, qué es buena práctica, qué es procedimiento interno y qué es recomendación de diseño, ver el documento `Sistema_Operativo_Digital_Cooperativa_Analisis.docx`.
