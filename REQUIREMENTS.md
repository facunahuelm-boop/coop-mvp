# REQUIREMENTS.md — Sistema Operativo Digital de la Cooperativa

> Documento de referencia principal del proyecto. Se escribe después de una auditoría completa del código real (Fase 1, 12/09), no de una arquitectura ideal ni inventada. Cada afirmación de esta sección está respaldada por lectura directa del código en `/home/user/coop-mvp-fresh` a esa fecha. Este documento se actualiza a medida que el sistema evoluciona (Fases 3 a 13 del plan de mejora estructural); no es un documento congelado.
>
> Metodología de la auditoría: lectura completa de `src/lib/db.ts`, `src/lib/tenant.ts`, `src/lib/auth.ts`, `src/lib/roles.ts`, `src/lib/comisionAuth.ts`, `src/lib/validation.ts`, `src/lib/upload.ts`, `src/lib/email.ts`, `src/lib/pdf.ts`, los 21 archivos en `migrations/*.sql`, los 20 archivos en `src/lib/actions/*.ts`, las ~23 rutas en `src/app/(app)/*`, `src/app/login`, `src/app/api/*`, y el sistema de componentes en `src/components/*`.

---

## 1. Objetivo del sistema

Plataforma de gestión interna para cooperativas de vivienda por ayuda mutua (modelo uruguayo de cooperativas FUCVAM/FECOVI), pensada para acompañar todo el ciclo de vida de una cooperativa: desde antes de la obra (pre_obra), durante la construcción (obra), hasta habitada (habitada). Hoy corre para una única cooperativa piloto real ("Ufama") pero **ya nació con aislamiento multi-tenant a nivel de base de datos** (una fila en `organizations` por cooperativa + Row-Level Security), por lo que el objetivo de evolucionarlo a SaaS multi-cooperativa es una extensión del diseño existente, no una reconstrucción.

El sistema no reemplaza a las personas ni a los profesionales responsables (IAT, contador, técnico prevencionista, escribano): ninguna pantalla aprueba automáticamente una compra, un pago, una decisión técnica o de seguridad — siempre hay un clic explícito de la persona u órgano con esa atribución. Este principio de diseño (ya presente en el código y en el README) debe conservarse en cualquier mejora futura.

## 2. Arquitectura general

### 2.1 Stack

| Capa | Tecnología | Notas |
|---|---|---|
| Framework | Next.js 16, App Router, Server Actions | Un solo proyecto para frontend y backend. React 19. |
| Base de datos | PostgreSQL vía Supabase | `pg` con SQL a mano en `src/lib/db.ts`, sin ORM. |
| Autenticación | Cookie firmada `coop_session` (JWT HS256 vía `jose`) + `bcryptjs` | Payload mínimo: `{uid, rol, org}`. 14 días de expiración. |
| Autorización | Matriz de roles estática en código (`src/lib/roles.ts`) + helpers finos por módulo | Ver sección 5. |
| Multi-tenancy | `organizations` (tabla raíz) + `organization_id` en ~30 tablas + Postgres RLS | Ver sección 2.2. |
| Archivos | Supabase Storage (bucket `uploads`, público en lectura) | **No** `public/uploads/` como dice el README — eso quedó desactualizado; ver hallazgo H-1. |
| Generación de PDF | `pdfkit` (dos implementaciones paralelas: `src/lib/pdf.ts` y `src/app/api/reportes/finanzas/route.ts`) | Ver hallazgo H-2. |
| Email | `nodemailer` + SMTP configurable por cooperativa (`config_email`) | Ver sección 2.6. |
| Estilos | Tailwind CSS v4 + tokens CSS custom properties (`--color-brand-*`, etc.) | Sistema de diseño ya tokenizado, ver sección 7. |
| IA | Motor de reglas local (`src/lib/ia.ts`) + Claude opcional vía `ANTHROPIC_API_KEY` | Nunca aprueba nada; siempre cita la fuente. |

### 2.2 Multi-tenancy — cómo funciona hoy (base para el SaaS)

- `organizations` es la tabla raíz: `id, slug (único), nombre, logo_url, foto_portada_url, color_primario, color_secundario, etapa (pre_obra|obra|habitada), plan (default 'trial'), activo, modulos_override (jsonb)`. No tiene `organization_id` (es ella misma el tenant) y **no tiene RLS** — es intencional, se protege con `withRootClient()`.
- Cada cooperativa se resuelve por subdominio en `proxy.ts` (middleware), que fija una cookie `coop_slug`. En desarrollo/sin subdominio propio, cae a `NEXT_PUBLIC_DEFAULT_ORG_SLUG` (hoy `coova`).
- Aislamiento real de datos: **RLS de Postgres**, no solo el filtro de la app. `db.ts` fija `SELECT set_config('app.current_org_id', $1, false)` en cada conexión prestada del pool (`withTenantClient`) antes de correr la query del caller; las políticas `tenant_isolation` (migración `0003_rls_policies.sql`) comparan `organization_id = current_setting('app.current_org_id')` en ~28 tablas con `FORCE ROW LEVEL SECURITY`.
- **Precondición operativa crítica, no solo de código**: esta protección solo es real si la conexión de producción usa un rol sin `BYPASSRLS`. Existe un rol `app_user` (`NOSUPERUSER, NOBYPASSRLS`) ya creado y con los `GRANT` correctos, expuesto a la app vía la variable opcional `APP_DATABASE_URL` en `db.ts` — pero si esa variable no está seteada en el entorno de producción, la app cae a `DATABASE_URL`/`POSTGRES_URL`, que apuntan al rol `postgres` (superusuario, `BYPASSRLS=true`), y en ese caso las políticas de RLS quedan **completamente inertes**: el único aislamiento real pasaría a ser el filtro `WHERE organization_id=?` de cada query manual, sin red de contención en la base. Este es el hallazgo de seguridad más importante de todo el sistema (ver H-SEC-1) y debe reverificarse como paso cero de cualquier trabajo de Fase 12.
- Dentro de esa protección, `insert()` inyecta automáticamente `organization_id` si falta en el payload; `all/get/run` no inyectan nada en el texto SQL (dependen de RLS); `update()` tampoco valida `organization_id` — depende 100% de RLS para no pisar filas de otra cooperativa. Esto es aceptable **solo** mientras la precondición del párrafo anterior se cumpla.
- `withRootClient`/`rootGet`/`rootAll` existen para las pocas consultas que deben ocurrir *antes* de tener un tenant resuelto (login: buscar la organización por slug) o contra `organizations` misma. Uso confirmado en `auth.ts`, `login/page.tsx`, `configuracion/page.tsx` y `api/setup/route.ts`. Se detectó un bug latente de bajo impacto en este último (ver H-3).
- **Implicación para el SaaS multi-cooperativa**: la arquitectura de aislamiento ya es la correcta para el objetivo final (fila por cooperativa + RLS). No hace falta rediseñarla; hace falta (a) confirmar la precondición de `APP_DATABASE_URL` en producción, (b) blindar `update()` con un chequeo defensivo adicional de `organization_id` a nivel de aplicación (defensa en profundidad, no reemplazo de RLS), y (c) decidir el modelo comercial multi-tenant (por subdominio ya soportado; falta un flujo de alta de cooperativa nueva self-service — hoy solo existe `api/setup`, un endpoint de desarrollo/seed).

### 2.3 Autenticación

Flujo completo (`src/lib/actions/auth.ts`, `src/lib/auth.ts`): resolución de organización por slug → chequeo de intentos fallidos recientes (`login_intentos`, con fail-open si la tabla no existe todavía) → búsqueda de usuario activo por `(organization_id, email)` → `bcrypt.compare` → registro del intento (éxito o fracaso) → firma de JWT con `{uid, rol, org}` → cookie httpOnly, `sameSite=lax`, `secure` en producción, 14 días.

Ya implementa correctamente una regla de seguridad de la Fase 3 pedida: **mensaje idéntico y deliberadamente genérico** ("Email o contraseña incorrectos.") para contraseña incorrecta vs. usuario inexistente, para no permitir enumeración de usuarios — esto es lo correcto, no hay que "arreglarlo" distinguiendo los casos como at first glance pediría un sistema de errores más específico; hay que documentarlo como excepción intencional.

La protección contra fuerza bruta (`login_intentos`, migración `0013`) está **completamente escrita y conectada**, solo inactiva porque la migración no está aplicada en producción (ver sección 2.2 del reporte de auditoría y sección 6, H-4).

`getCurrentUser()` no confía ciegamente en el JWT: re-consulta el usuario en cada request y lo invalida si `activo=0` o si `organization_id` ya no coincide con el claim del token.

### 2.4 Autorización — resumen (detalle completo en sección 5)

Modelo de rol único por usuario (`users.rol`, columna de texto, no una tabla `roles`), con una matriz estática `MATRIX: Record<Role, Record<Module, Access>>` en `src/lib/roles.ts`, más una capa de helpers finos por módulo para casos que la matriz no puede expresar (ver sección 5.3). Confirmado en la auditoría: **todo control de UI tiene su espejo exacto en el backend** en las áreas revisadas — no se encontró ningún caso de "solo se oculta en el frontend". Esto es una fortaleza real del sistema actual que debe preservarse activamente en cualquier refactor.

### 2.5 Almacenamiento de archivos y generación de documentos

Todo archivo (documentos subidos, PDFs generados, fotos de avance de obra, fotos de incidentes de seguridad, logo de marca) va a **Supabase Storage**, bucket `uploads`, en rutas `organization_id/carpeta/archivo` vía `src/lib/upload.ts` (`saveUploadedFile`/`saveGeneratedFile`). El bucket es **público en lectura** y las URLs (con sufijo aleatorio de 4 bytes) se guardan tal cual en columnas `archivo_url`/`comprobante_url`/`foto_url`. No existe ninguna ruta `/api` que sirva o revalide un archivo — la descarga es directamente la URL pública de Supabase. Este es el segundo hallazgo de seguridad más importante del sistema (H-SEC-2, detalle en sección 6) y es exactamente el problema que la Fase 11 del plan de mejora pide resolver.

Los reportes generados desde `/reportes` (obra, finanzas, trabajo) también se suben a este mismo bucket público y **se acumulan indefinidamente** sin TTL ni borrado — otro punto directo de la Fase 11. Existe ya, sin embargo, un precedente correcto del patrón deseado: `src/app/api/reportes/finanzas/route.ts` genera el PDF en memoria y lo devuelve directo como respuesta HTTP (`Content-Disposition: attachment`, sin persistir nada) — es el modelo a generalizar, no algo que haya que inventar desde cero.

### 2.6 Email y notificaciones

Email es **el único canal de notificación que existe** en todo el sistema — no hay notificaciones in-app, ni push, ni tabla `notificaciones`. Dos caminos de envío, hoy con lógica duplicada:

1. **Envío manual** (`/mails` → `enviarMailAction` → `enviarEmailPersonalizado`, en `src/lib/email.ts`): un único formulario combinado (usuario individual / comisión / "todos" — mutuamente excluyentes, sin conteo de destinatarios antes de enviar), sin ningún modal ni componente reutilizable (los primitivos `Modal`/`ConfirmDialog` de `src/components/ui-client.tsx` existen pero **no están conectados a ninguna pantalla todavía**). No se puede enviar un email desde ningún otro lugar del sistema hoy (ni desde un perfil de socio, ni desde una comisión).
2. **Alertas críticas automáticas** (`crearAlerta()` en `logic.ts` → `enviarEmailAlerta()`, también en `email.ts`): dispara solo si `severidad === "critica"` y la categoría está habilitada en `alertas_email`. Comparte la configuración SMTP con el camino manual pero **no comparte código de armado/envío** — es una segunda implementación completa.

El historial de ambos caminos se guarda en `mensajes_correo` (migración `0014`/`0016`/`0021`, **no aplicada aún en producción** al momento de este documento). `enviarEmailPersonalizado` tiene un `throw` no capturado si el SMTP no está configurado, *antes* de su propio try/catch interno — esto es lo que causó el error de producción ya documentado en este proyecto (React error #441) cuando se probó el envío con una configuración SMTP inválida.

### 2.7 APIs y rutas

Rutas API existentes hoy: `src/app/api/admin/migraciones` (herramienta temporal de mantenimiento, a borrar una vez usada), `src/app/api/buscar` (buscador global / Command Palette), `src/app/api/gastos/export`, `src/app/api/reportes/finanzas`, `src/app/api/setup` (seed/desarrollo, no debería existir accesible en producción real más allá del bootstrap inicial). No hay ninguna API de autenticación de terceros, ni webhooks, ni integración externa.

### 2.8 Frontend / sistema de diseño

Ver sección 7 (convenciones existentes a preservar) — hay un sistema de componentes tokenizado real (`Card`, `PageHeader`, `Badge`, `Button`, `EmptyState`, `StatTile`, `Label`, `inputClass`, `Table/Th/Td`) más primitivos de UI ya construidos pero no adoptados (`Modal`, `ConfirmDialog`, `ToastProvider`, `Skeleton`). El shell de navegación (`Sidebar`/`TopBar`/`BottomNav`) es genuinamente responsive; las pantallas de contenido (tablas y formularios) son desktop-first con scroll horizontal como red de seguridad, no mobile-first pese a lo que dice el README.

## 3. Entidades principales y relaciones (modelo real)

Agrupadas por dominio. `[T]` = tiene `organization_id` (tenant-scoped) y RLS. `[R]` = tabla raíz sin `organization_id`.

**Plataforma / identidad**
- `organizations` `[R]` — la cooperativa. `slug, nombre, logo_url, color_primario/secundario, etapa, plan, modulos_override, activo`.
- `users` `[T]` — cuenta de acceso. `nombre, email (único por organización), password_hash, rol, nucleo_id?, activo`. **Un rol por usuario** (no hay tabla `roles` ni multi-rol hoy).
- `nucleos_familiares` `[T]` — unidad del módulo Trabajo (horas de ayuda mutua). `nombre, cuota_social, horas_acumuladas, horas_semanales_objetivo`. **No tiene estado activo/inactivo** (única tabla del sistema sin soft-delete).
- `login_intentos` `[T]` (pendiente de migrar) — control de fuerza bruta.

**Personas y vivienda** (concepto distinto y solo parcialmente cruzado con `users`/`nucleos_familiares` — ver nota abajo)
- `socios` `[T]` — el padrón real de personas socias. `nombre, documento, email, telefono, estado (activo|inactivo|baja), vivienda_id?, nucleo_id?, user_id?, fecha_ingreso`. `user_id` es opcional: un socio puede no tener cuenta de acceso.
- `socio_integrantes` `[T]` (pendiente de migrar) — integrantes del hogar bajo un socio. `nombre, apellido, documento, fecha_nacimiento, telefono, email, relacion, tipo_integrante (adulto|menor), estado (activo|inactivo)`.
- `viviendas` `[T]` — unidad habitacional. `numero (único por cooperativa), estado (en_obra|terminada|ocupada)`.
- `lista_espera` `[T]` — aspirantes previos a convertirse en socio. `nombre, documento, contacto, orden, estado (en_espera|convocado|incorporado|retirado)`.
- `movimientos_cuenta_socio` `[T]` — cuenta corriente por socio (cargo|pago), independiente de `movimientos_financieros` (la caja general).

> **Nota de diseño importante**: `nucleos_familiares` (motor de Trabajo/ayuda mutua) y `socios`+`socio_integrantes` (padrón de personas) son **dos modelos de datos distintos que conviven**, cruzados solo opcionalmente vía `socios.nucleo_id`. Cualquier trabajo de la Fase 5 (Contactos) y Fase 7 (navegación transversal) tiene que decidir explícitamente cómo unificar la *vista* de estas dos fuentes sin fusionar los modelos de datos (que cumplen propósitos distintos: uno para asignar tareas de jornada, otro para membresía/padrón formal).

**Comisiones y gobierno**
- `comisiones` `[T]` — órgano de trabajo (Obra, Compras, Seguridad, etc.). `nombre, descripcion, activa`.
- `comision_miembros` `[T]` — membresía muchos-a-muchos `users`↔`comisiones`, con `rol_en_comision (coordinador|integrante)`, `activo`, `desde/hasta`. **Sin restricción de unicidad** `(comision_id, user_id)` hoy.
- `reuniones` `[T]` — asamblea, consejo directivo o de comisión. `tipo, comision_id?, titulo, fecha, estado, acta_id?, creado_por_id`.
- `reunion_asistencias` `[T]` — asistencia por núcleo a una reunión, `UNIQUE(reunion_id, nucleo_id)`.
- `actas` `[T]` — acta de una reunión, vinculada a un `documento_id` en el repositorio.
- `tareas` `[T]` — tablero de tareas genérico por comisión (nullable) y/o por reunión (nullable).

**Obra / Trabajo / Seguridad (etapa de construcción)**
- `tareas_obra`, `avances_obra`, `problemas_obra` `[T]` — cronograma, avances con foto, problemas/observaciones (con dependencia simple entre tareas vía auto-referencia).
- `jornadas_trabajo`, `tareas_jornada`, `asignaciones_jornada`, `asistencias`, `habilidades_nucleo` `[T]` — motor de jornadas de ayuda mutua, asignación por núcleo.
- `documentos_seguridad`, `inspecciones_seguridad`, `incidentes_seguridad` `[T]` — documentación con vencimiento, checklists, incidentes con nota de IA "asistencia preliminar".

**Compras y proveedores**
- `proveedores` `[T]` — `nombre, contacto/rubro` (legado) + `rut, telefono, email, direccion, persona_contacto, tipo (empresa|persona_fisica), estado (nuevo|habitual|en_evaluacion|inactivo)` (extensión pendiente de migrar). **Sin unicidad** en `rut`/`nombre`/`email`.
- `solicitudes_compra`, `presupuestos_proveedor`, `decisiones_compra` `[T]` — pedido → presupuestos comparados (nunca elige automáticamente) → decisión con motivo. `solicitudes_compra.comision_id` (FK, pendiente de migrar) convive con el campo de texto libre legado `comision`.
- `gastos_comision` `[T]` (pendiente de migrar) — gasto por comisión, con ciclo `pendiente→pagado→anulado`, que al marcarse pagado genera un `movimientos_financieros` vinculado.

**Finanzas y documentos**
- `movimientos_financieros`, `presupuesto_general`, `compromisos_futuros` `[T]` — caja general, presupuesto vs. real, compromisos futuros.
- `documentos`, `documento_categorias` `[T]` — repositorio con categorías personalizables por cooperativa.
- `reportes_generados` `[T]` — historial de reportes PDF/Excel generados.

**Comunicación, alertas y auditoría**
- `mensajes_correo` `[T]` (pendiente de migrar) — historial de todo envío de email (manual o automático por alerta), con `destinatario_tipo/id` (referencia polimórfica, **sin FK real**), `destinatarios` (snapshot JSONB), `estado (enviado|fallido)`.
- `notas_calendario` `[T]` (pendiente de migrar) — notas libres de calendario.
- `alertas` `[T]` — alertas generadas por el motor de reglas (documentos vencidos, tareas atrasadas, riesgos abiertos, desvíos de presupuesto, disponible prudencial negativo, tareas de jornada sin cubrir).
- `alertas_email`, `config_email` `[T]` — preferencias y configuración SMTP por cooperativa.
- `auditoria` `[T]` — registro de solo lectura de acciones sensibles (quién, qué, cuándo, valor anterior/nuevo).
- `reclamos` `[T]` — reclamos de mantenimiento, relevantes desde la etapa "habitada".

## 4. Reglas de negocio confirmadas (no inventadas)

- Ningún módulo permite que un algoritmo apruebe una compra, un pago, una decisión técnica o de seguridad: siempre hay un registro explícito de quién decidió y por qué (`decisiones_compra.decidido_por_id/motivo`, `incidentes_seguridad` con nota de IA que se aclara "no reemplaza al responsable").
- Distinción explícita entre saldo bancario y **disponible prudencial** (saldo − comprometido) en Finanzas; solo roles de conducción (`administracion, tesoreria, consejo_directivo, fiscal, admin`, constante `ROLES_FINANZAS_DETALLE`) ven montos detallados — el resto ve un resumen.
- La visibilidad de módulos de obra (Obra/Trabajo/Seguridad) y de Reclamos depende de la `etapa` de la cooperativa (`pre_obra|obra|habitada`), con la posibilidad de forzar manualmente por módulo desde Configuración (`modulos_override`), sin borrar nunca los datos subyacentes — ocultar un módulo no destruye su información.
- Convención sistemática de **no-borrado físico**: casi todas las entidades de negocio usan una columna `estado`/`activo` en lugar de `DELETE`, para no perder historial (ver detalle en sección 7). Las excepciones son un puñado de entidades genuinamente efímeras (notas de calendario, algunas líneas de compra sin historial propio) donde sí hay `DELETE FROM` real, siempre protegido por RLS aunque la sentencia no lleve `organization_id` explícito en el WHERE.
- Reclamos: cualquier socio puede crear un reclamo, pero **no puede tomarlo/resolverlo aunque su rol tenga "edit" en el módulo** — regla de negocio ya corregida en una auditoría de seguridad anterior (`puedeGestionarReclamos`, ver sección 5.3).
- Un socio puede ver su propia cuenta corriente sin tener rol de finanzas (`esElPropioSocio`), pero no la de otro socio.
- El acceso a gestionar una comisión específica requiere pertenecer a ella (o tener un rol de conducción que supervisa todas) — un rol de "comisión de compras" no puede operar sobre la comisión de obra ajena.
- El mensaje de error de login es deliberadamente idéntico entre "contraseña incorrecta" y "usuario inexistente", para no filtrar qué parte falló (política de seguridad, no un defecto a corregir).

## 5. Roles y permisos

### 5.1 Roles actuales (11, un string por usuario)

`socio, comision_obra, comision_trabajo, comision_compras, comision_seguridad, administracion, tesoreria, consejo_directivo, fiscal, tecnico, admin`

### 5.2 Matriz módulo × acceso (`Access = none|read|edit|approve|config`)

| Rol | obra | trabajo | compras | seguridad | finanzas | documentos | auditoria | comisiones | socios | reclamos |
|---|---|---|---|---|---|---|---|---|---|---|
| socio | read | read | none | read | read | read | none | read | read | edit* |
| comision_obra | edit | read | edit | read | none | read | none | edit | read | read |
| comision_trabajo | read | edit | edit | read | none | read | none | edit | read | read |
| comision_compras | read | read | edit | read | read | read | none | edit | read | read |
| comision_seguridad | read | read | edit | edit | none | read | none | edit | read | edit |
| administracion | read | read | read | read | edit | edit | none | edit | edit | edit |
| tesoreria | read | read | approve | read | approve | read | read | read | read | read |
| consejo_directivo | approve | approve | approve | approve | approve | edit | read | approve | approve | approve |
| fiscal | read | read | read | read | read | read | read | read | read | read |
| tecnico | edit | read | read | edit | none | read | none | read | read | edit |
| admin | config | config | config | config | config | config | read | config | config | config |

`*` en `reclamos`, "edit" significa cosas distintas por rol (crear vs. gestionar) — ver 5.3, `puedeGestionarReclamos`.

### 5.3 Helpers de permisos finos (ya existentes, no hay que inventarlos)

| Helper | Qué resuelve | Patrón |
|---|---|---|
| `puedeGestionarReclamos(rol)` | excluye a `socio` de tomar/resolver aunque tenga `edit` | carve-out sobre la matriz |
| `puedeGestionarComision(user, comisionId)` | ¿pertenece a *esa* comisión o es rol de conducción? | scoping por fila (join con `comision_miembros`) |
| `esOversightComisiones/Reuniones(rol)` | crear/archivar un órgano entero, no solo operarlo | alias de `canEdit(rol,"finanzas")` |
| `esElPropioSocio` / `puedeVerCuenta` | ver la propia cuenta sin rol de finanzas | scoping por identidad |
| `puedeModificar(user, autorId)` | dueño de una nota o admin/consejo | ownership |
| `puedeUsarGastos(rol)` | unión de dos módulos (`compras` o `finanzas`) | unión de permisos de matriz |

### 5.4 Diseño propuesto para el sistema de permisos granular (Fase 4 — no implementado aún, solo especificado acá)

Para no romper nada de lo anterior, el modelo de permisos granulares (`users.view`, `commissions.manage`, `documents.download`, etc.) debe **construirse como una capa nueva sobre la matriz actual, no como su reemplazo inmediato**:

1. Entidades nuevas: `roles` (fila por rol, hoy implícitas como strings — pasar a tabla permite roles personalizados por cooperativa a futuro sin tocar código), `permissions` (catálogo de strings `recurso.accion`), `role_permissions` (rol↔permiso). Mantener `users.rol` como está (no se transforma a multi-rol todavía) para no romper la matriz ni los 6 helpers finos existentes.
2. Cada permiso string se resuelve, en una primera etapa, **derivándolo de la MATRIX existente** (una función `tienePermiso(user, "documents.download")` que por dentro sigue llamando a `canRead/canEdit` según corresponda) — así el sistema queda "listo" para permisos independientes sin tener que migrar los 20 archivos de actions de una sola vez.
3. Los 6 helpers finos de la sección 5.3 no desaparecen: representan reglas que un permiso plano no puede expresar solo (scoping por fila, por dueño, por comisión específica). El diseño final combina "¿tiene el permiso?" (nuevo, plano) + "¿sobre esta fila en particular?" (existente, fino) — igual que hoy combina MATRIX + helper.
4. Un usuario podrá, a futuro, tener más de un permiso adicional a su rol base (ej. un `socio` con el permiso extra `documents.create` para una situación puntual) sin que eso implique multi-rol — eso resuelve el pedido de "extensible sin rehacer" sin inventar un sistema de roles compuestos que el resto del código no está preparado para consumir.

## 6. Hallazgos de la auditoría (por severidad)

### Seguridad — requieren decisión y trabajo antes o durante Fase 11/12

- **H-SEC-1 (crítico, operativo no de código) — RESUELTO, verificado en vivo (12/09)**: el aislamiento multi-tenant real depende de que `APP_DATABASE_URL` esté seteada en producción apuntando al rol `app_user` (sin `BYPASSRLS`). Se agregó `/api/admin/diagnostico-rls` (temporal, solo admin) y se confirmó en vivo: `rol_conectado: "app_user"`, `es_superusuario: false`, `puede_saltar_rls: false` — el aislamiento por RLS entre cooperativas es real en producción hoy.
- **H-SEC-2 (crítico, funcional) — PARCIALMENTE RESUELTO (12/09)**: no existía ninguna ruta de descarga mediada; todo archivo se servía desde un bucket de Supabase Storage público en lectura, por URL directa guardada en la base. Se agregaron `getSignedUrl()` y dos rutas mediadas (`/api/archivos/documento/[id]`, `/api/archivos/reporte/[id]`) que re-verifican sesión, cooperativa (vía RLS) y permiso antes de generar una URL firmada de corta duración; Documentos, Reportes y el acta de una Reunión ya enlazan ahí en vez de a la URL directa — verificado en vivo. Falta para el cierre completo: el bucket sigue siendo público (una URL vieja ya obtenida seguiría funcionando), y las fotos de Obra/Seguridad/Reclamos y los comprobantes de Gastos todavía muestran la URL directa — extender el mismo patrón ahí es condición para poder pasar el bucket a privado sin romper esas pantallas. Detalle en `CHANGELOG.md`.
- **H-SEC-3 (medio)**: `update()` en `db.ts` no valida `organization_id` a nivel de aplicación — depende 100% de RLS. Mientras H-SEC-1 esté resuelto esto es aceptable, pero se recomienda una verificación defensiva adicional (defensa en profundidad) antes de escribir, no como sustituto de RLS.
- **H-SEC-4 (bajo)**: `mensajes_correo.destinatario_id` es una referencia polimórfica sin FK real — no compromete el aislamiento entre cooperativas (sigue con `organization_id`+RLS) pero permite inconsistencias de integridad referencial dentro de una misma cooperativa.

### Consistencia / experiencia — motivan las Fases 3, 9 y 10

- **H-1**: el README describe el almacenamiento de archivos como `public/uploads/`, desactualizado — ya migró a Supabase Storage. Actualizar la documentación es una tarea menor pero real (para no confundir a quien lea el README y crea que hay que migrarlo).
- **H-2**: existen dos implementaciones paralelas de generación de PDF (`src/lib/pdf.ts` y `src/app/api/reportes/finanzas/route.ts`) con lógica de dibujo duplicada. Unificar en un solo motor es preferible antes de extender la generación de reportes en la Fase 11.
- **H-3**: `api/setup/route.ts` usa `withRootClient` para contar usuarios de una tabla con RLS (`users`) sin resetear `app.current_org_id` en la conexión prestada del pool — puede devolver un conteo incorrecto (no una fuga entre cooperativas, sí un bug de exactitud) por reutilización de conexión. Bajo impacto porque es un endpoint de seed/desarrollo, pero hay que corregirlo si `api/setup` se mantiene vivo en producción.
- **H-4**: 9 migraciones (`0013` a `0021`) documentadas y ya construidas en código no están aplicadas en producción al momento de este audit (a reconfirmar). Mientras tanto, la ausencia de `notas_calendario` rompe una funcionalidad real ("Agregar nota al calendario"), y varias features nuevas (gastos por comisión, proveedores extendido, integrantes de socio, historial de email) están inactivas o degradadas.
- **H-5**: el mismo error de "tabla faltante" (Postgres 42P01) se maneja de tres formas distintas según el archivo: silenciarlo en lecturas (correcto), loguear-y-continuar en escrituras de historial (correcto), o convertirlo en un mensaje más amable pero igual relanzarlo (rompe la UI vía la pantalla de error genérica) — inconsistencia a resolver centralmente en la Fase 3.
- **H-6**: ninguna acción del sistema usa `useActionState` salvo el login. Todo `throw new Error(...)` de validación o autorización termina en la pantalla genérica "Ocurrió un problema" en producción, ocultando mensajes ya bien escritos en el código (ej. "Este proveedor ya tiene presupuestos...", "Este gasto ya está pagado..."). El patrón correcto ya existe en el login (`(prevState, formData) => ({error?})` + `useActionState` + render inline) y debe generalizarse, no inventarse.
- **H-7**: `configuracion.ts` y `reportes.ts` usan `redirect("/login")` ante un fallo de permisos en lugar de `throw new Error("No autorizado")` como el resto de los módulos — inconsistente (el usuario ve un logout inesperado en vez de un mensaje de "no autorizado").
- **H-8**: no hay chequeo de unicidad en ningún lado (email/documento/RUT duplicados en `socios`/`proveedores`) — cualquier duplicado hoy fallaría (si hay constraint de base) con un error crudo de Postgres, no con un mensaje entendible.
- **H-9**: navegación cruzada persona↔detalle existe solo en 3 lugares (socios, finanzas→socios, proveedores/compras); comisiones, reuniones, obra, gastos, auditoría y mails muestran nombres como texto plano sin enlace. Núcleos familiares no tienen página de detalle propia (`/nucleos/[id]` no existe). Esto confirma que la Fase 7 es trabajo genuinamente nuevo.
- **H-10**: no existe paginación en ningún listado — todos usan `LIMIT` fijo (15/50/200), lo que hace invisibles los registros más viejos en vez de paginarlos. Los únicos filtros reales existentes son: tags en documentos, tabs de estado en proveedores, y filtros multi-campo por querystring en gastos (sin paginación real, solo `LIMIT 200`).
- **H-11**: `Modal`, `ConfirmDialog` y `ToastProvider` ya están construidos en `src/components/ui-client.tsx` pero no están conectados a ninguna pantalla. El patrón de confirmación de borrado real y ya usado es "escribí ELIMINAR para confirmar" en un `<details>` — hay que decidir si se reemplaza por `ConfirmDialog` (recomendado, ya existe el componente) o se mantiene.
- **H-12**: no existe ningún componente ni flujo reutilizable de envío de email — `/mails` es la única puerta de entrada, sin preview de destinatarios ni invocación desde otros módulos. Además, el envío manual (`enviarEmailPersonalizado`) y el de alertas automáticas (`enviarEmailAlerta`) duplican por completo la lógica de armado/envío, compartiendo solo la configuración SMTP.
- **H-13**: no existe ninguna sección "Contactos" ni página de perfil de usuario genérica — sí existe una página de perfil de socio sólida (`socios/[id]`) que debe usarse como base para extender, no reconstruir.

## 7. Convenciones existentes a preservar (no reinventar)

- **Sin borrado físico**: usar `estado`/`activo`, nunca `DELETE`, salvo en entidades genuinamente efímeras y ya identificadas (notas de calendario, líneas de compra sin historial).
- **Capa de acceso a datos única**: toda la app pasa por `src/lib/db.ts` (`all/get/insert/update/run`) y `src/lib/logic.ts` — nunca SQL directo en páginas/actions. Cualquier mejora nueva debe seguir usando esta capa.
- **Validación centralizada**: `src/lib/validation.ts` (`parseForm` + helpers Zod `zTexto/zMonto/zFecha/zEmailOpcional/zEnumSeguro...`) ya es el estándar; extenderlo (agregar validador de teléfono, de unicidad) en vez de crear un sistema nuevo en paralelo.
- **Autorización en dos capas ya probada**: matriz de módulo (`roles.ts`) + helper fino cuando la matriz no alcanza (`comisionAuth.ts` y media docena de helpers locales). El patrón de la Fase 4 debe sumarse a esto, no reemplazarlo.
- **Sistema de diseño tokenizado**: `Card, PageHeader, SectionTitle, Badge, Button, EmptyState, StatTile, Label, inputClass, Table/Th/Td` sobre variables CSS (`--color-brand-*`, etc.), ya usado de forma consistente en casi todas las pantallas. Cualquier trabajo de Fase 10 extiende este sistema (activa `Modal/ConfirmDialog/ToastProvider/Skeleton`, ya construidos pero no conectados) en vez de crear uno nuevo.
- **Multi-org por diseño**: cualquier tabla nueva debe llevar `organization_id` + política RLS `tenant_isolation`, siguiendo exactamente el patrón de las migraciones `0004` en adelante (son el mejor ejemplo a copiar).
- **Migraciones idempotentes y versionadas**: `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, numeradas, registradas en `schema_migrations`, aplicadas por `scripts/run-migrations.mjs`. Nunca modificar una migración ya aplicada; siempre agregar una nueva.

## 8. Glosario de términos del dominio

- **Núcleo familiar**: unidad usada por el módulo Trabajo para asignar horas de ayuda mutua y cuota social; no es lo mismo que un socio.
- **Socio**: persona con membresía formal en la cooperativa (padrón), puede o no tener cuenta de acceso al sistema.
- **Comisión**: órgano de trabajo (Obra, Compras, Seguridad, Trabajo, Fiscal, etc.) con miembros e integrante coordinador.
- **Etapa**: fase de vida de la cooperativa (`pre_obra`, `obra`, `habitada`), determina qué módulos son relevantes por defecto.
- **Disponible prudencial**: saldo bancario menos lo ya comprometido — la cifra que de verdad importa para decidir gastos, distinta del saldo bancario bruto.
- **IAT**: Instituto de Asistencia Técnica (dirección técnica de la cooperativa, rol `tecnico` en el sistema).

---

*Fin de Fase 1 (auditoría) y Fase 2 (este documento). Las Fases 3 a 13 del plan de mejora estructural se documentan incrementalmente en `CHANGELOG.md` a medida que se implementan, siguiendo el orden acordado y sin empezar una fase sin haber cerrado la anterior.*
