# CHANGELOG — Mejora estructural del sistema

Registro de cada fase del plan de mejora estructural ("Prompt Maestro"), en el orden acordado: Fase 1 Auditoría → Fase 2 REQUIREMENTS.md → Fase 3 Validaciones/errores → Fase 4 Roles/permisos → Fase 5 Contactos → Fase 6 Perfil individual → Fase 7 Navegación transversal → Fase 8 Paginación/búsqueda/filtros → Fase 9 Email → Fase 10 UI/UX → Fase 11 Descargas/documentos → Fase 12 Performance/seguridad/multi-tenancy → Fase 13 QA completo.

No se salta ninguna fase sin cerrar la anterior. Cada entrada documenta: qué se hizo, qué archivos/tablas/APIs cambiaron, qué se decidió y por qué, y qué queda pendiente.

## Fase 1 — Auditoría completa del proyecto (12/09)

**Qué se hizo**: lectura completa (sin cambios de código) de la capa de datos (`src/lib/db.ts`, `src/lib/tenant.ts`, `migrations/*.sql` — 21 archivos), autenticación y permisos (`src/lib/auth.ts`, `src/lib/roles.ts`, `src/lib/comisionAuth.ts`), las 23 rutas de `src/app/(app)/*` y sus componentes (`src/components/*`), las 20 acciones de servidor en `src/lib/actions/*.ts` y sus patrones de validación, y el circuito completo de documentos/PDF/email/notificaciones (`src/lib/upload.ts`, `src/lib/email.ts`, `src/lib/pdf.ts`, `src/app/api/reportes/*`).

**Decisión de enfoque**: no se tocó ningún archivo de código en esta fase, tal como pide el plan. El objetivo era construir una imagen completa y verificada (no supuesta) de cómo está armado el sistema hoy, para que las fases siguientes se apoyen en la arquitectura real y no dupliquen ni reemplacen algo que ya funciona.

**Hallazgos principales** (detalle completo en `REQUIREMENTS.md`, sección 6):
- Dos hallazgos de seguridad que deben resolverse durante las Fases 11/12: (a) el aislamiento multi-tenant real depende de una variable de entorno (`APP_DATABASE_URL`) cuya presencia en producción no se pudo reconfirmar desde este entorno; (b) no existe ninguna ruta de descarga mediada — todo archivo se sirve desde una URL pública de Supabase Storage sin re-verificar sesión, cooperativa ni permiso.
- El sistema de validación (Zod centralizado en `src/lib/validation.ts`) ya es consistente y reutilizado en las 20 acciones; el problema real de errores no es de validación sino de que ningún formulario salvo el login usa `useActionState`, así que cualquier error ya bien escrito en el código termina tapado por la pantalla genérica de error de Next.js.
- La generación de PDF y la subida de archivos ya migraron de lo que describe el README (disco local) a Supabase Storage — el README quedó desactualizado en ese punto.
- El sistema de diseño (`Card/PageHeader/Badge/Button/EmptyState/Table`, tokens CSS) es consistente y reutilizable; existen primitivos de UI ya construidos pero no conectados (`Modal`, `ConfirmDialog`, `ToastProvider`, `Skeleton`).
- No existe hoy: paginación en ningún listado, sección "Contactos", flujo de email reutilizable/invocable desde otros módulos, ni navegación cruzada persona↔perfil salvo en 3 lugares puntuales (socios, finanzas→socios, proveedores).
- 9 migraciones (`0013` a `0021`) siguen sin confirmarse como aplicadas en producción — se recomienda reverificar esto antes de cualquier trabajo de Fase 4/5 que dependa de sus tablas (`socio_integrantes`, `gastos_comision`, `mensajes_correo`, `notas_calendario`, extensión de `proveedores`).

**Archivos afectados**: ninguno (fase de solo lectura).

**Pendiente**: nada de esta fase queda abierto; sus hallazgos alimentan directamente el resto del plan.

## Fase 2 — REQUIREMENTS.md (12/09)

**Qué se hizo**: se creó `REQUIREMENTS.md` como documento de referencia principal del proyecto, con el objetivo del sistema, la arquitectura general (stack, multi-tenancy, autenticación, autorización, almacenamiento, email, APIs, frontend), el modelo real de entidades y relaciones (no inventado — extraído de las migraciones y el esquema real), las reglas de negocio confirmadas, el modelo de roles y permisos actual junto con una propuesta concreta para el sistema de permisos granular de la Fase 4 (diseñada como una capa adicional sobre la matriz existente, no como su reemplazo), la lista completa de hallazgos de la auditoría por severidad, y las convenciones existentes que cualquier fase futura debe preservar.

**Decisión de enfoque**: el diseño de permisos granulares (`Role`/`Permission`/`RolePermission`) se especificó para construirse *sobre* la matriz `MATRIX` y los 6 helpers finos ya existentes (`puedeGestionarReclamos`, `puedeGestionarComision`, etc.), en vez de reemplazarlos — esos helpers resuelven casos (scoping por fila, por comisión, por dueño) que un permiso plano tipo `recurso.accion` no puede expresar por sí solo.

**Archivos afectados**: `REQUIREMENTS.md` (nuevo), `CHANGELOG.md` (nuevo, este archivo).

**Pendiente**: presentar la auditoría y el REQUIREMENTS.md al usuario antes de iniciar cambios de código de la Fase 3 en adelante, dado que a partir de acá el trabajo empieza a tocar producción.
