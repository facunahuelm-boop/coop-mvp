# Arquitectura de datos — Comisiones como sistema de gestión (Fase 1)

Documento de diseño previo al código, tal como pide el pedido del usuario
("REGLA FINAL": analizar antes de implementar). Cubre las 12 fases del plan.
Se apoya en una auditoría real del código existente (no en supuestos) —
resumen de lo auditado en la sección 0.

## 0. Qué ya existe (resumen de la auditoría)

- `comisiones` / `comision_miembros`: ya existen, básicos (nombre, activa,
  rol_en_comision coordinador|integrante). Sin tipo/objetivo/fechas/suplentes.
- `tareas`: genérica, ya vinculada a `comision_id` y `reunion_id`. Sin
  checklist, sin dependencias, sin etiquetas, sin colaboradores.
- `reuniones` / `reunion_asistencias` / `actas`: ya existen como módulo
  propio (`/reuniones`). Agenda es un solo campo de texto libre
  (`orden_del_dia`), asistencia es por núcleo (pensada para
  asamblea/consejo, no para integrantes de comisión).
- `documentos`: patrón real = una FK nullable por caso de uso (hoy solo
  `solicitud_compra_id`), no hay columna genérica `entidad_tipo/entidad_id`.
- Notificaciones: no existe bandeja por usuario. Lo más parecido es
  `alertas` (motor de reglas recalculado en cada navegación, no un inbox
  por evento) — se mantiene intacto, es un sistema distinto y sigue
  cubriendo su caso de uso actual.
- `mensajes_correo`: historial de emails enviados (no es mensajería interna).
- Integración Comisión↔Compras↔Finanzas ya existe:
  `solicitudes_compra.comision_id`, `gastos_comision` (comisión→proveedor→
  movimiento financiero), `puedeGestionarComision`/`puedeUsarGastos` en
  `comisionAuth.ts`.
- Permisos: matriz de roles (`roles.ts`) da acceso al módulo "comisiones";
  `comisionAuth.ts` exige además ser miembro activo de ESA comisión
  puntual (doble capa: módulo + instancia). Este patrón se reutiliza para
  todo lo nuevo.
- Componentes reutilizables confirmados: `Card/PageHeader/Badge/Button/
  EmptyState/StatTile` (ui.tsx), `Modal/ConfirmDialog/Tabs/ActionForm/
  SubmitButton` (ui-client.tsx), `TablaFiltrable+FilaConDetalle+EstadoBadge`,
  patrón `ResumenXxx` (tile chico → click → pop-up) ya usado en
  Compras/Finanzas.

## 1. Principio de diseño

Extender, no duplicar: cuando ya existe una tabla/patrón que cubre el
caso (comisiones, comision_miembros, tareas, documentos por FK,
gastos_comision, auditoria), se la extiende con columnas nuevas. Sólo se
crean tablas nuevas para conceptos que genuinamente no existen hoy:
solicitudes entre comisiones, decisiones formales, votaciones, agenda
estructurada de reunión, participantes de reunión por usuario,
comunicaciones estructuradas, notificaciones por usuario.

## 2. Extensiones a tablas existentes

- **`comisiones`**: `+ tipo TEXT DEFAULT 'permanente'` (permanente|temporal),
  `+ objetivo TEXT`, `+ fecha_inicio TEXT`, `+ fecha_fin TEXT`, `+
  comision_padre_id INTEGER REFERENCES comisiones(id)` (subcomisiones,
  punto 6 del pedido — autorreferencia simple, sin límite de profundidad
  impuesto en la base, la UI decide cuánto anidar). El archivado ya existe
  (`activa`), no se toca.
- **`comision_miembros`**: sin cambio de esquema — `rol_en_comision` ya es
  TEXT libre sin CHECK; se suma 'suplente' como valor válido a nivel de
  código (Fase 2).
- **`tareas`**: `+ checklist JSONB DEFAULT '[]'` (subtareas simples
  [{texto, hecho}], mismo criterio que `destinatarios JSONB` en
  mensajes_correo), `+ depende_de_id INTEGER REFERENCES tareas(id)`
  (mismo patrón que `tareas_obra.depende_de_id`, ya probado), `+
  etiquetas TEXT` (CSV, mismo patrón que `documentos.etiquetas`), `+
  solicitud_id INTEGER REFERENCES solicitudes_comision(id)`.
- **`reuniones`**: `+ modalidad TEXT DEFAULT 'presencial'`
  (presencial|virtual|hibrida).
- **`documentos`**: nuevas FKs nullable siguiendo el patrón ya usado para
  `solicitud_compra_id`: `+ comision_id`, `+ solicitud_comision_id`, `+
  tarea_id`, `+ reunion_id`, `+ decision_id`, `+ comunicacion_id`. Más
  versionado: `+ version INTEGER DEFAULT 1`, `+ reemplaza_a_id INTEGER
  REFERENCES documentos(id)`.

## 3. Tablas nuevas

- **`tarea_colaboradores`** (tarea_id, user_id) — colaboradores además
  del responsable único ya existente.
- **`solicitudes_comision`** — el corazón de las Fases 3/4: numero
  ("SOL-2026-0001", asignado post-insert), tipo, titulo, descripcion,
  comision_origen_id, comision_destino_id, creado_por_id, responsable_id,
  prioridad, estado, fecha_limite, creado_en/actualizado_en. Distinta de
  `solicitudes_compra` (que sigue siendo específica de Compras) — esto es
  el pedido "entre comisiones" genérico (información/aprobación/tarea/
  consulta/derivación/etc.), aunque un tipo puede ser "compra" y esa
  solicitud puede eventualmente enlazar a una `solicitudes_compra` real
  vía comentario/documento, sin fusionar los modelos.
- **`solicitud_comentarios`** — comentarios/pedidos de información sobre
  una solicitud (comunicación contextual, no chat suelto).
- **`solicitud_eventos`** — historial/trazabilidad dedicado (creada,
  recibida, en_revision, informacion_solicitada, aprobada, rechazada,
  derivada — con de/a comisión —, resuelta, cancelada). Además de esto
  cada acción sigue llamando al `audit()` genérico existente, igual que
  el resto del sistema.
- **`decisiones_comision`** — registro formal (DEC-2026-0087), separado
  de conversación/propuesta: comision_id, reunion_id?, solicitud_id?,
  tema, propuesta, resultado, decidido_por_id, fecha. Distinta de
  `decisiones_compra` (que sigue siendo la decisión de proveedor en
  Compras) — ésta es la decisión de gobierno de una comisión.
- **`votaciones`** + **`voto_respuestas`** — encuesta/votación/decisión
  formal como tipos distintos (campo `tipo`), opciones en JSONB, un voto
  por usuario (UNIQUE votacion_id+user_id).
- **`reunion_agenda_items`** — puntos de agenda ordenados, cada uno con
  responsable/documentos/decisión/resultado — reemplaza gradualmente el
  texto libre `orden_del_dia` (que se mantiene, nunca se borra info vieja).
- **`reunion_invitados`** — participantes por usuario (confirmado/
  presente), complementa (no reemplaza) `reunion_asistencias` que sigue
  siendo por núcleo para asamblea/consejo.
- **`comunicaciones`** + **`comunicacion_lecturas`** — comunicación
  estructurada por tipo (privada/entre_comision/general/consejo/
  administrativa/urgente) con confirmación de lectura; no es chat libre,
  siempre tiene asunto y puede referenciar solicitud/tarea/decisión.
- **`notificaciones`** — bandeja real por usuario (tipo, titulo, cuerpo,
  ref_tabla/ref_id, leida). Distinta y complementaria de `alertas`
  (que es un motor de reglas recalculado, no un inbox de eventos) — no
  se reemplaza `alertas`, se agrega esto para los eventos puntuales que
  pide el punto 24 (recibí una solicitud, me asignaron una tarea, etc.).

## 4. Orden de implementación (igual al que pidió el usuario)

Fase 1 (este documento + migración 0029 con todo el esquema de una sola
vez, para no obligar al usuario a correr una migración manual por cada
fase) → Fase 2 comisiones dinámicas → 3 solicitudes/derivación → 4 tareas
extendidas → 5 reuniones/agenda/actas → 6 decisiones/votaciones → 7
comunicaciones/notificaciones → 8 documentos con contexto/versionado → 9
integración Compras/Proveedores/Finanzas → 10 Mi trabajo/Requiere mi
atención/Centro de actividad → 11 auditoría de seguridad/rendimiento → 12
pruebas end-to-end de los 4 flujos completos.

Cada fase se implementa, verifica (tsc/eslint/build) y despliega por
separado, documentada en CHANGELOG.md, siguiendo el mismo criterio ya
usado en el resto del proyecto — no se hacen las 12 de una sola vez.
