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

## Adelanto de seguridad (fuera de orden, a pedido explícito del usuario) — hallazgos H-SEC-1 y H-SEC-2 (12/09)

Antes de seguir con la Fase 3, el usuario pidió resolver primero los dos hallazgos de seguridad más críticos de la auditoría (Fase 1), por su gravedad — corresponden en rigor a las Fases 11/12, pero se adelantan puntualmente sin alterar el orden del resto del plan.

**H-SEC-1 — ¿es real el aislamiento entre cooperativas en producción?** Se agregó `src/app/api/admin/diagnostico-rls/route.ts` (temporal, solo admin, solo lectura): usa la misma conexión (`pool` de `src/lib/db.ts`) que usa el resto de la app en producción para preguntarle a Postgres con qué rol está conectada y si ese rol puede saltarse Row-Level Security. **Verificado en vivo, logueado como admin: `rol_conectado: "app_user"`, `es_superusuario: false`, `puede_saltar_rls: false`.** Confirma que `APP_DATABASE_URL` está bien configurada en Vercel (el trabajo de una fase anterior, "Fase 04 del Plan Maestro") y que el aislamiento por RLS entre cooperativas es real, no solo el filtro manual de cada consulta.

**H-SEC-2 — descargas sin verificación de permisos.** Documentos, Reportes y el acta de una Reunión imprimían en el HTML la URL pública y permanente del archivo en Supabase Storage — quien la obtuviera (compartida, en el historial del navegador) podía descargarla para siempre, sin sesión ni pertenecer a la cooperativa, sin que el sistema pudiera saberlo ni impedirlo.

- Se agregó `getSignedUrl()` en `src/lib/upload.ts`: a partir de la URL guardada en la base, genera una URL firmada de corta duración (120s) recién en el momento de la descarga.
- Se agregaron dos rutas mediadas: `src/app/api/archivos/documento/[id]/route.ts` y `src/app/api/archivos/reporte/[id]/route.ts`. Cada una exige sesión activa, permiso del módulo (`canRead(user.rol,"documentos")` para documentos; para reportes, ser quien lo generó — la misma regla que ya aplicaba la pantalla) y usa `get()` para buscar la fila, que ya filtra por `organization_id` vía RLS: un id de otra cooperativa da "no encontrado", nunca el archivo ajeno.
- Se actualizaron las tres pantallas que antes imprimían la URL directa para que enlacen a estas rutas en su lugar: `src/app/(app)/documentos/page.tsx`, `src/app/(app)/reportes/page.tsx` y `src/app/(app)/reuniones/[id]/page.tsx` (link del acta).
- **Verificado en vivo, logueado como admin**: los tres links ahora apuntan a `/api/archivos/...` (ya no a la URL de Supabase); pedir un id inexistente da 404 limpio (no crash); pedir sin sesión da 401; pedir el propio documento/reporte redirige correctamente a una URL firmada real de Supabase y descarga el archivo. Sin errores nuevos en consola ni en Network.

**Qué queda pendiente, a propósito, y por qué**: esto reduce el riesgo real (ya no se expone la URL directa en el HTML, y cada descarga re-verifica sesión/permiso/entidad) pero **no cierra el hallazgo por completo**, porque el bucket `uploads` de Supabase Storage sigue siendo público en lectura — una URL vieja ya obtenida antes de este cambio, o reconstruida a mano, todavía funcionaría. Cerrarlo del todo requiere pasar el bucket a privado, y eso recién es seguro hacerlo después de extender este mismo patrón (URL firmada + ruta mediada) a los demás lugares que hoy muestran archivos directo desde el bucket: fotos de Obra (`avances_obra`/`problemas_obra`), fotos y documentos de Seguridad (`incidentes_seguridad`/`documentos_seguridad`), fotos de Reclamos, y comprobantes de Gastos (`gastos_comision`/`movimientos_financieros`) — si se pasara el bucket a privado ahora, esas pantallas dejarían de mostrar sus imágenes. La marca de la cooperativa (logo/portada) debe seguir siendo pública a propósito (se muestra en el login, sin sesión). Este trabajo restante queda explícitamente como parte de la Fase 11 cuando le toque el turno.

**Archivos afectados**: `src/lib/upload.ts`, `src/app/api/admin/diagnostico-rls/route.ts` (nuevo, temporal), `src/app/api/archivos/documento/[id]/route.ts` (nuevo), `src/app/api/archivos/reporte/[id]/route.ts` (nuevo), `src/app/(app)/documentos/page.tsx`, `src/app/(app)/reportes/page.tsx`, `src/app/(app)/reuniones/[id]/page.tsx`. Sin cambios de base de datos. Desplegado y verificado en vivo (commit `19047b4`).

## Fase 3 — Sistema global de errores y validaciones (12/09, en progreso)

**Qué se hizo**: siguiendo el hallazgo H-6 (ver `REQUIREMENTS.md`), se construyó la infraestructura para que las acciones del servidor dejen de depender de la pantalla genérica de error de Next.js, y se convirtió el primer formulario real como caso de prueba.

- **Infraestructura nueva**:
  - `src/lib/validation.ts`: `parseForm()` ahora lanza `ValidationError` (con `.field`) en vez de un `Error` genérico cuando el problema es identificable a un campo puntual — sin cambiar el texto de `.message`, así que ningún código existente que lo lea se rompe.
  - `src/lib/db.ts`: se agregó `relanzarConMensajeSiFaltaTabla()`, que centraliza el manejo del error Postgres 42P01 ("falta una tabla" — típicamente una migración pendiente, ver H-4). Reemplaza dos versiones locales duplicadas e inconsistentes entre sí, en `calendarioNotas.ts` (no registraba en auditoría) y `gastos.ts` (si registraba) — resuelve H-5.
  - `src/lib/actionState.ts` (nuevo): tipo `ActionState` (`{ok, error?, fieldErrors?}`) y `conEstadoDeAccion()`, que envuelve la lógica real de una acción y atrapa sus errores esperables (`ValidationError`, reglas de negocio, permisos) para devolverlos como datos en vez de relanzarlos — dejando pasar intactos los `redirect()`/`notFound()` de Next.js, que no hay que interceptar.
  - `src/components/ui-client.tsx`: se agregaron `FormError`, `FieldError` y `SubmitButton` (usa `useFormStatus` para deshabilitarse solo mientras la acción está en curso). Además, `ToastProvider` — construido en una fase anterior pero nunca montado — ahora se monta una sola vez en `src/app/(app)/layout.tsx`, disponible (`useToast()`) para toda la app.
- **H-7** (inconsistencia real encontrada al revisar el código, distinta de lo que decía el hallazgo original — ver `REQUIREMENTS.md`): `src/lib/actions/configuracion.ts` mezclaba "sin sesión" y "sin permiso" en un solo `redirect("/login")` en sus 5 acciones. Se agregó `requireAdminOConsejo()`, que separa los dos casos (redirect solo si no hay sesión; `Error` con mensaje claro si el rol no alcanza). `reportes.ts` se revisó y ya estaba correcto — no necesitaba el cambio que el hallazgo original le atribuía.
- **Primer formulario convertido — notas de calendario** (elegido primero porque hoy mismo hace crash en producción, no solo por prolijidad): `src/lib/actions/calendarioNotas.ts` gana tres funciones nuevas (`crearNotaCalendarioFormAction`, `editarNotaCalendarioFormAction`, `eliminarNotaCalendarioFormAction`) que envuelven a las acciones originales (sin tocarlas) con `conEstadoDeAccion`. `src/components/MonthCalendar.tsx` se reorganizó en dos subcomponentes nuevos (`NotaFormulario`, `NotaBorrarForm`) que usan `useActionState`: el formulario de agregar/editar ahora muestra el error de validación junto al campo (`FieldError`) o el mensaje general arriba del botón (`FormError`) en vez de crashear, y el borrado muestra su error como toast si falla (ej. intentar borrar una nota ajena). Las páginas `/calendario` y el Dashboard (que comparten este componente) se actualizaron para pasarle las nuevas acciones.

**Decisión de enfoque**: no se convirtieron los ~19 formularios restantes en esta misma pasada — la fase avanza de forma incremental (se documenta el progreso parcial, como pide el plan maestro) priorizando primero el que ya rompe algo real en producción. El resto (documentos, proveedores, socios, y así sucesivamente) se va a ir convirtiendo con el mismo patrón (`*FormAction` + `useActionState` + `FormError`/`FieldError`/`SubmitButton`) en los próximos pasos, sin que eso bloquee reportar este avance.

**Archivos afectados**: `src/lib/validation.ts`, `src/lib/db.ts`, `src/lib/actionState.ts` (nuevo), `src/lib/actions/calendarioNotas.ts`, `src/lib/actions/gastos.ts`, `src/lib/actions/configuracion.ts`, `src/components/ui-client.tsx`, `src/components/MonthCalendar.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/calendario/page.tsx`, `src/app/(app)/dashboard/page.tsx`. Sin cambios de base de datos. `npx tsc --noEmit` sin errores.

**Pendiente**: convertir el resto de los formularios del sistema al mismo patrón (Documentos, Proveedores, Socios primero, según lo acordado); luego seguir con la Fase 4.
