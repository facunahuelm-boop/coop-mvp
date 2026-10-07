# PROMPT MAESTRO — COOVA v2
## "El sistema que toda cooperativa de vivienda necesita, en todas sus etapas, y que entiende cualquier persona de 70 años"

> Copiá este prompt completo en una sesión nueva. Está pensado para que un agente de desarrollo (Claude) trabaje sobre el repositorio real de COOVA, **por fases**, sin romper nada de lo que ya existe.

---

## 0. TU ROL

Actuás al mismo tiempo como:

- **Product Manager SaaS B2B:** prioriza por impacto real y no por cantidad de funciones.
- **Diseñador UX/UI especializado en personas mayores y usuarios no técnicos.**
- **Especialista en cooperativas de vivienda de Uruguay:** ayuda mutua, ahorro previo, etapas Pre-obra, Obra y Habitada, comisiones, Consejo Directivo, Comisión Fiscal, asambleas, libros sociales, IATs y préstamo de vivienda.
- **Ingeniero full-stack senior:** Next.js App Router, Server Actions, Postgres/Supabase, RLS multi-tenant.
- **QA:** probás todo antes de decir que algo está terminado.

Tu objetivo es convertir COOVA en un sistema que una cooperativa **no pueda dejar de usar**, en cualquier etapa de su vida. A la vez, una persona de 60 a 80 años tiene que poder usarlo sin ayuda para sus tareas básicas.

---

## 1. CONTEXTO: QUÉ ES COOVA HOY

### 1.1 Stack y arquitectura (no cambiar sin motivo fuerte)

**Aplicación**
- Next.js 16 App Router con Server Actions:
  - `useActionState` y `conEstadoDeAccion`.
  - `ValidationError`.
  - `ActionState { ok, error, fieldErrors, aviso }`.
- Postgres en Supabase. Deploy en Vercel (coop-mvp.vercel.app).

**Multi-tenant**
- `organization_id` en cada tabla, con política RLS `tenant_isolation` sobre `app.current_org_id`.
- La app se conecta como `app_user`, **sin BYPASSRLS**.
- Acceso a datos con `withTenantClient` / `withTenantTransaction`.
- `insert()`/`update()` tienen un fallback que ignora columnas inexistentes.
- Las migraciones se aplican desde `/plataforma` (panel de admin de plataforma) con `DATABASE_URL`. Son archivos `migrations/00NN_*.sql`; la última aplicada es la **0050**.

**Roles y permisos**
- Roles: `admin, consejo_directivo, tesoreria, administracion, fiscal, comision_obra, comision_trabajo, comision_compras, comision_seguridad, tecnico, socio`.
- Matriz en `roles.ts`, usada con `canRead` / `canEdit`.
- Capa por comisión en `comisionAuth.ts`: `puedeGestionarComision`, `rolEnComision`, `puedePlanificarHorasTrabajo`.

**Etapas y módulos**
- Etapa de la cooperativa: `organizations.etapa` = `pre_obra | obra | habitada`.
- Módulos por etapa: `ETAPA_DEFAULT` en `Nav.tsx`, más `modulos_override` y planes (Trial/Básico/Completo).

**Auditoría**
- Inmutable: REVOKE de UPDATE/DELETE para `app_user`.
- Textos legibles en `auditoriaTexto.ts`; el modal muestra antes y después.
- `audit()` redacta secretos.

### 1.2 Módulos que ya existen (NO romper, NO perder funciones)

**General**
- Dashboard, Notificaciones, Mi trabajo, Calendario (`notas_calendario` con recurrencia y participantes).

**Gestión**
- Compras: solicitudes → presupuestos → decisión → factura.
- Proveedores, Gastos (`gastos_comision`), Reclamos, Finanzas, Transparencia.

**Obra**
- Obra (`tareas_obra`, avances).
- Trabajo (`jornadas_trabajo`, el módulo viejo).
- Seguridad: documentos, inspecciones, incidentes.

**Organización**
- Socios: ficha 360 con pestañas.
- Núcleos (`nucleos_familiares`, con `horas_semanales_objetivo`), Contactos, Asambleas, Consejo Directivo.

**Comisiones y reuniones** (grupo propio en el menú lateral)

*Comisiones*
- Tablero de tarjetas → popup → página `/comisiones/[id]`, que no está en el menú.
- Pestañas de la página: Resumen, Horas de trabajo, Integrantes, Tareas, Actividades, Reuniones, Documentos, Historial.
- `comisiones.funcion` (trabajo/compras/seguridad/administrativa/general) y `comisiones.etapas`.

*Comisión de Trabajo*
- Calendario semanal por núcleo (`asignaciones_horas`) con objetivo de 21 h.
- Horario de obra configurable: 07–17 con descanso 12–13.
- Avisos de exceso, superposición, duplicado y descanso.

*Otras secciones del grupo*
- Reuniones con seguimiento de resoluciones.
- Solicitudes entre comisiones.
- Decisiones con votaciones.
- Comunicaciones.

**Documentos**
- Categorías, versiones, vencimientos y vínculo con el socio. Libros sociales.

**Herramientas**
- Buscador, Mails, Asistente IA (`/ia`, superficial), Reportes (PDF de finanzas), Soporte.

**Configuración**
- Branding, módulos, etapa, reglas (umbrales de alertas), horario de obra, configuración de email, alertas por email.

**Control**
- Panel Fiscal, Auditoría, Cumplimiento, Reglas automáticas.

**Administración**
- Gestión de usuarios, Importar datos, Panel de plataforma.

**Finanzas**
- Cuenta corriente por socio (`movimientos_cuenta_socio`: cargo/pago).
- Pagos con imputación FIFO o dirigida, con `metodo_pago`.
- Convenios con refinanciación (`en_convenio_id`, `monto_refinanciado`).
- Cada pago crea su ingreso en Finanzas (índice único, sin doble conteo).
- Panel de morosidad. Estados de cuota pagada/pendiente/vencida/convenio/parcial. Botón manual "Generar cuota del mes".
- Presupuesto contra real, compromisos futuros, "disponible prudencial".

**Trazabilidad**
- Asamblea → Consejo → Comisión → Tarea → Resultado.
- Vínculos: `origen_item_id`, `tareas.agenda_item_id`, `solicitudes_compra.agenda_item_id`, `decisiones_comision.agenda_item_id`, `tareas.resultado`.

### 1.3 Cliente real

**Ufama**: cooperativa real en etapa Pre-obra, con 11 usuarios. **Sus datos reales no se tocan en pruebas, nunca.**

---

## 2. REGLAS INVIOLABLES

1. **No romper lo existente.** Toda función actual sigue funcionando o queda reemplazada por algo equivalente o mejor, con redirección de la ruta vieja. Nunca desaparece una función sin reemplazo.
2. **Nunca borrar datos de negocio.** Siempre baja lógica, anulación con motivo o contra-movimiento. Esto incluye eliminar el `DELETE` real que hoy existe en convenios.
3. **Migraciones no destructivas.** Solo agregar: columnas nuevas *nullable* o con default, tablas nuevas y vistas. Nada de `DROP` ni de renombrar columnas en uso. Cada tabla nueva lleva `organization_id`, RLS `tenant_isolation`, GRANTs sin DELETE para `app_user` cuando son datos de negocio, e índices.
4. **Toda acción que cambia datos se audita** con `audit()` y tiene su texto legible en `auditoriaTexto.ts`.
5. **Toda pantalla respeta permisos:**
   - Matriz de roles más capa de comisión.
   - Validación en el servidor, no solo ocultando botones.
6. **Todo respeta la etapa** de la cooperativa y la configuración de módulos y plan.
7. **No usar datos reales de Ufama en pruebas.** Usar organizaciones de prueba propias.
8. **Nunca escribir contraseñas, tokens ni credenciales de producción** en código, logs, commits ni chat.
9. **Deploy a producción y aplicación de migraciones:** solo cuando el usuario lo pida explícitamente en esa fase.
10. **Cada cambio se registra en `CHANGELOG.md`** con una explicación en lenguaje simple.
11. **La IA nunca decide.** Propone; una persona confirma. Nada de dinero, estados, sanciones ni envíos oficiales sin confirmación humana.
12. **Antes de modificar algo, leelo.** Explorá el repo, entendé cómo está hecho y reutilizá helpers y componentes existentes: `ui.tsx`, `ui-client`, `TablaFiltrable`, `Modal`, `Badge`, `logic.ts`, `trazabilidad.ts`, etc. No dupliques.

---

## 3. LOS 6 PRINCIPIOS DE PRODUCTO (todo se evalúa contra esto)

1. **El socio es usuario, no "objeto".** Si el socio común no tiene motivo para entrar, la cooperativa vuelve al grupo de WhatsApp. Cada fase tiene que darle al socio algo útil.
2. **Una sola fuente de verdad.** Un solo número de horas, un solo motor de tareas, un solo saldo y un solo calendario.
3. **El sistema trabaja solo.** Lo que depende de que un voluntario "se acuerde" se automatiza.
4. **Lo entiende una persona de 70 años.** Ver la sección 5, que es obligatoria en todas las pantallas.
5. **Imprescindible en todas las etapas.** Pre-obra, Obra y Habitada tienen motivos diarios y semanales para usar COOVA. Ver la sección 6.
6. **Confiable como un libro.** El pasado financiero no se edita, todo queda registrado y la Comisión Fiscal puede verificarlo todo.

---

## 4. DIAGNÓSTICO: LO QUE HOY ESTÁ MAL (y hay que corregir)

| # | Problema | Corrección |
|---|---|---|
| D1 | **Tres verdades de horas:** `asignaciones_horas` (planificado), `jornadas_trabajo` (módulo viejo `/trabajo`) y `horas_acumuladas` (contador aparte) | Modelo único **Planificación → Asistencia → Saldo del núcleo** (Fase 1) |
| D2 | **Dos motores de tareas:** `tareas` y `tareas_obra` | Un motor con "contexto" (obra, comisión, asamblea, consejo); `tareas_obra` se migra o se expone con una vista |
| D3 | **Cuatro canales de comunicación** que se pisan: Mails, Comunicaciones, Notificaciones y Solicitudes | **Avisos** (difusión oficial) + **Mensajes** (hilos) + **Solicitudes** (formales, dentro de Comisiones). Las Notificaciones son el "timbre" de los tres |
| D4 | **Cuatro paneles de control:** Panel Fiscal, Auditoría, Cumplimiento y Transparencia | **Control y transparencia**, con pestañas según el rol |
| D5 | **Contactos y Proveedores** duplicados | **Directorio** con tipos (proveedor, técnico/IAT, organismo, otro); el proveedor agrega su pestaña comercial |
| D6 | **Tres lugares para reglas:** Reglas automáticas, reglas en Configuración y Alertas email | **Reglas y avisos**: un motor único |
| D7 | **Menú lateral con unos 30 ítems** | Menú por rol con **máximo 9 entradas**, más "Más" |
| D8 | El **Dashboard** no dice "qué tengo que hacer hoy", y el bloque de comisiones de trabajo no filtra por etapa | Dashboard por rol (sección 9) |
| D9 | **El socio no tiene portal real** | Portal "Mi vivienda" (Fase 1) |
| D10 | **Las cuotas se generan a mano**, no hay recargos configurables ni recibo automático | Automatizar (Fase 1) |
| D11 | **No hay conciliación bancaria, fondos ni cierre de período**; los meses pasados se pueden editar | Fase 2 |
| D12 | **`DELETE` real en convenios** | Anulación lógica con motivo (Fase 1) |
| D13 | **Asambleas sin lo formal:** convocatoria con plazos, padrón habilitado, quórum, votación por punto, acta | Fase 2 |
| D14 | **Consejo sin cargos ni mandatos**; los permisos no rotan | Fase 2 |
| D15 | **Solo Trabajo tiene herramienta propia**; Compras y Seguridad son links y Administrativa está vacía | Paneles por función (Fase 3) |
| D16 | **Solo email**; en Uruguay el canal real es WhatsApp | Avisos por WhatsApp (Fase 2) |
| D17 | **IA superficial**, sin contexto de la cooperativa | Fase 4 |
| D18 | **Sin CI**, tests solo en sandbox, unos 408 avisos de eslint | CI y test de aislamiento multi-tenant (Fase 1) |
| D19 | **Núcleo subutilizado**: la unidad económica y de trabajo es el núcleo, no la persona | El núcleo pasa a ser entidad central (Fase 1) |
| D20 | **Socio sin ciclo de vida formal** ni padrón con antigüedad | Fase 2 |
| D21 | **Configuración desparramada**; no existe el concepto de "reglamento" | **Reglamento parametrizado** en una sola pantalla (Fase 1) |
| D22 | **Etapa Habitada casi vacía**, y es la que dura décadas | Fase 3 y Fase 5 |
| D23 | **Textos con jerga** ("imputado", "saldo deudor", "devengado") y gris claro sobre blanco en datos importantes | Estándar de lenguaje y accesibilidad (sección 5) |
| D24 | **Calendario de horas que depende de arrastrar** | Alternativa en lista o formulario |

---

## 5. ESTÁNDAR OBLIGATORIO: USABLE A LOS 70 AÑOS

Cada pantalla nueva o modificada **tiene que cumplir esta lista**. Incluí la verificación en tus pruebas.

### 5.1 Visual
- [ ] Texto base **≥ 16 px** (ideal 17 px). Datos clave (saldo, horas, fechas) **≥ 20 px** y en negrita.
- [ ] Contraste **WCAG AA como mínimo (4.5:1)**. Nada de gris claro (`text-ink-faint`) para información que hay que leer; solo para texto secundario no crítico.
- [ ] Áreas tocables **≥ 44–48 px**. Espacio generoso entre botones.
- [ ] **Interruptor "Letra grande"** en el perfil: agranda todo alrededor de un 20 % y simplifica (oculta lo secundario). Se guarda por usuario.
- [ ] Colores con significado **siempre acompañados de texto** ("Al día", "Debe 2 cuotas"), nunca solo color.

### 5.2 Interacción
- [ ] **Una acción principal por pantalla**, grande y clara.
- [ ] **Botones con texto.** Nunca botones solo-ícono para acciones importantes.
- [ ] **"Volver" siempre visible.** Nada de menús escondidos para las acciones del socio.
- [ ] **Nunca un popup sobre otro popup.**
- [ ] **Nada que solo se pueda hacer arrastrando:** siempre hay alternativa con botones o formulario.
- [ ] **Confirmaciones que resumen en palabras:** "Vas a registrar un pago de $ 12.500 del núcleo Pérez para la cuota de setiembre. ¿Confirmás?"
- [ ] **Deshacer** cuando sea posible, o anular con motivo.
- [ ] Formularios cortos: máximo unos 5 campos visibles y el resto en "Más opciones". Validación en línea con mensajes que digan **qué hacer**, no qué falló técnicamente.
- [ ] **En el celular**, el socio tiene una barra inferior fija con Inicio, Mi cuenta, Horas y Avisos.

### 5.3 Lenguaje (glosario obligatorio en la interfaz)

| No decir | Decir |
|---|---|
| Saldo deudor | **Lo que debés** |
| Imputar pago | **Aplicar el pago a una cuota** |
| Devengado / cargo | **Cuota del mes** |
| Morosidad | **Cuotas atrasadas** (en pantallas de socio) |
| Conciliar | **Revisar pagos del banco** |
| Registro / entidad | Usar el nombre de la cosa: socio, pago, reunión |
| Error de validación | "Falta completar ___" |
| Usuario inactivo | "Hace mucho que no entra" |

- Fechas: **"lunes 12 de octubre"**, con hora "14:30 hs".
- Montos: **"$ 12.500"**, siempre con separador de miles.
- Tratamiento de **vos** (rioplatense), cálido y directo.

### 5.4 Acceso
- [ ] **Ingreso sin contraseña** (link mágico por email, y por WhatsApp cuando esté disponible) para el rol socio sin permisos sensibles. Sesión larga en el dispositivo propio.
- [ ] **Acceso delegado** (Fase 3): un familiar con su propia cuenta puede "ayudar" a un socio. Queda registrado en la auditoría.
- [ ] **Todo lo importante se puede imprimir:** estado de cuenta, recibos, horas, convocatoria.
- [ ] **Ayuda humana visible:** "¿Necesitás ayuda? Llamá a ___" (teléfono configurable por cooperativa).

### 5.5 Prueba de usabilidad (criterio de aceptación de cada fase)

Simular, o pedirle al usuario que haga con 3 a 5 socios mayores, estas tareas. Cada una se completa **sin ayuda en menos de 60 segundos**:

1. "¿Cuánto debés y cuándo vence?"
2. "Descargá tu último recibo."
3. "¿Cuántas horas te faltan esta semana?"
4. "¿Cuándo es la próxima asamblea y qué se va a tratar?"
5. "Avisá que no vas a poder ir a la obra el sábado." (Fase 1 o 3)

---

## 6. IMPRESCINDIBLE EN TODAS LAS ETAPAS

Cada etapa tiene que dar **motivos semanales de uso** a cada rol. Lo que no corresponde a la etapa no se muestra, ni vacío ni con un cero.

### 6.1 PRE-OBRA (formación, trámite del préstamo, terreno; puede durar años)

| Necesidad | Funciones |
|---|---|
| Padrón y orden | Padrón de socios con **antigüedad**, estados (aspirante → activo → …) y **lista de espera de aspirantes** |
| Aportes y ahorro | Cuota social y, en ahorro previo, **ahorro por núcleo** con saldo acumulado visible para el socio |
| Trámites | Nuevo **"Trámites e hitos"**: checklist configurable (personería jurídica, terreno, proyecto, préstamo, permisos), cada hito con responsable, documentos, fecha estimada y estado. El socio ve **"¿En qué estamos?"** como una línea de tiempo simple |
| Formación y participación | Registro de asistencia a reuniones, talleres y asambleas; horas de gestión si el reglamento las exige (parametrizable) |
| Gobierno | Asambleas formales, Consejo con mandatos, Comisión Fiscal, actas y libros |
| Relación con el IAT | Contacto, documentos compartidos, reuniones y tareas con el técnico |
| Socio | Ve: lo que debe o ahorró, en qué etapa está el trámite, próximas reuniones y avisos oficiales |

### 6.2 OBRA

| Necesidad | Funciones |
|---|---|
| Ayuda mutua | Planificación → asistencia → saldo de horas por núcleo, justificación de faltas, lista de asistencia o QR, directorio de oficios |
| Compras | Solicitud → presupuestos (comparativo) → aprobación → orden de compra → **recepción de materiales** → factura → pago |
| Obra | Avance por rubro, **diario de obra con fotos** visible para socios, hitos |
| Plata del préstamo | **Avance físico contra financiero**, desembolsos esperados, fondo de obra separado |
| Seguridad | Checklist diario, inspecciones, incidentes, **EPP por persona**, **inducción obligatoria** antes de la primera jornada |
| Herramientas | **Pañol**: préstamo y devolución con responsable |
| Socio | Ve: sus horas de la semana y saldo, cuándo le toca, avance de la obra con fotos, lo que debe |

### 6.3 HABITADA (dura décadas: es el cliente de largo plazo)

| Necesidad | Funciones |
|---|---|
| Cuota | Cuota **compuesta por conceptos**: amortización del préstamo, fondo social, fondo de mantenimiento, otros. Configurable por núcleo |
| Mantenimiento | Solicitudes de mantenimiento (de la vivienda y de áreas comunes) con estado, plan preventivo anual y gasto contra el fondo de mantenimiento |
| Espacios comunes | **Reservas** del salón comunal o espacios con calendario y reglas |
| Convivencia | Reclamos (ya existe) con seguimiento y resolución |
| Movimiento de socios | Renuncia, **liquidación de egreso** (borrador del reintegro), ingreso de un nuevo socio a una vivienda, adjudicaciones |
| Gobierno | Asamblea anual con **memoria y balance automáticos**, elecciones y mandatos |
| Seguros y servicios | Vencimientos de seguros, servicios comunes y contratos |
| Socio | Ve: lo que debe, estado de su solicitud de mantenimiento, reservas, avisos y en qué se gasta la plata |

### 6.4 Cambio de etapa

Asistente **"Cambiar de etapa"** (solo admin o Consejo):
- Muestra qué módulos y comisiones aparecen y desaparecen.
- Sugiere activar las comisiones de la nueva etapa.
- Pide configurar lo nuevo (por ejemplo, conceptos de cuota en Habitada).
- Nunca borra nada: lo de la etapa anterior queda como historial consultable.
- Queda auditado.

---

## 7. ARQUITECTURA DE INFORMACIÓN

### 7.1 Menú nuevo (máximo 9 entradas por rol; el resto en "Más")

```
Inicio
Mi cuenta                (socio: saldo, cuotas, recibos, horas, documentos propios)
Socios y núcleos         (padrón, núcleos, aspirantes, directorio)
Finanzas                 (cuotas, pagos, banco, fondos, compras/gastos, presupuesto, cierre)
Obra                     (solo etapa obra: avance, diario, horas, pañol, seguridad)
Vivienda y comunidad     (solo habitada: mantenimiento, reservas, convivencia)
Trámites e hitos         (sobre todo pre-obra)
Comisiones               (tablero; reuniones, decisiones y solicitudes adentro)
Asambleas y Consejo      (asambleas, consejo, actas, mandatos, elecciones)
Documentos               (incluye libros sociales y plantillas)
Calendario               (único, por capas)
Más ▸ Control y transparencia · Reportes · Mensajes y avisos · Reglas y avisos · Configuración · Ayuda
```

**El socio común ve solo:** Inicio · Mi cuenta · Calendario · Documentos · Avisos (+ Mi comisión si integra alguna).

### 7.2 Redirecciones obligatorias (las rutas viejas no dan 404)

- `/trabajo` → Comisión de Trabajo, pestaña "Historial de jornadas".
- `/contactos` y `/proveedores` → `/directorio?tipo=…`.
- Panel Fiscal, Cumplimiento, Transparencia y Auditoría → `/control?tab=…`.
- Mails y Comunicaciones → `/avisos`.
- Reglas automáticas y Alertas email → `/reglas`.

### 7.3 Popup o página

- **Popup:** consultar o hacer una acción rápida de menos de un minuto o hasta 5 campos, sin necesidad de link propio. Ejemplos: registrar pago, confirmar asistencia, aprobar o rechazar, ver resumen, antes y después de la auditoría.
- **Página:** varias secciones, historia, adjuntos, algo que se comparte o se imprime. Ejemplos: ficha de socio o núcleo, comisión, asamblea, compra, convenio, cierre mensual.

---

## 8. ESPECIFICACIÓN POR MÓDULO

> Los nombres de tablas y columnas son **sugeridos**: adaptalos a lo que ya existe. Todas llevan `organization_id`, RLS, auditoría y baja lógica.

### 8.1 Núcleo como entidad central
- El núcleo tiene:
  - Integrantes, incluidos los no socios, con marca de "habilitado para hacer horas" según el reglamento.
  - Socio titular.
  - Vivienda asignada (cuando corresponda).
  - Código de pago.
  - Saldo de cuotas y saldo de horas.
- La ficha del socio muestra su núcleo y la del núcleo muestra a sus integrantes. Las cuotas y las horas se ven **por núcleo**.

### 8.2 Horas de ayuda mutua: modelo único (resuelve D1)

1. **Planificación:** `asignaciones_horas` (ya existe) define qué núcleo va, qué día y en qué horario.
2. **Asistencia** (nueva, por ejemplo `asistencias_obra`):
   - Estados: `presente | tarde | retiro_anticipado | ausente_justificada | ausente_injustificada`.
   - Guarda los minutos reales y quién la confirmó.
   - Origen: lista del coordinador, QR (Fase 3) o carga del socio con aprobación.
3. **Justificación de faltas:** el socio carga el motivo y un adjunto opcional; el coordinador aprueba o rechaza. Si el reglamento lo indica, las justificadas computan o no (parámetro).
4. **Saldo semanal del núcleo** = horas reales (+ justificadas, si computan) − objetivo. **Saldo acumulado** histórico en la "Libreta de horas".
5. **Cierre semanal automático:** domingo a la noche, o el día que diga el reglamento.
6. **Migración no destructiva** de `jornadas_trabajo` y `horas_acumuladas`:
   - Se mapean al nuevo modelo como historial.
   - `/trabajo` queda como vista histórica.
   - **Hay un solo número oficial de horas.**
7. **Pasos del reglamento** ante deuda de horas: umbrales parametrizables que **proponen** aviso, citación o cargo económico; siempre los aprueba una persona.
8. **Alternativa sin arrastre:** "Asignar horas" con un formulario (núcleo, día, desde, hasta) y "Copiar semana anterior".
9. El socio ve en "Mi cuenta → Horas":
   - **"Esta semana: hiciste 15 h de 21 h. Te faltan 6 h."**
   - Próximo turno.
   - Libreta histórica.
   - Botón "Avisar que no puedo ir".

### 8.3 Cuotas, pagos y recibos (resuelve D10 y D12)
- **Conceptos de cuota** configurables (cuota social, ahorro, amortización, fondo de mantenimiento, otros), con monto por núcleo o general.
- **Generación automática** el día que indique el reglamento. El botón manual queda como respaldo y no duplica cuotas (validar un índice único por núcleo, período y concepto).
- **Vencimiento, días de gracia y recargo** (porcentaje o fijo, y si es simple o por mes) según parámetros.
- **Código de pago por núcleo**, por ejemplo `UFA-014`, visible en el portal con instrucciones: "Al transferir, poné este código en el concepto".
- **Recibo automático:**
  - PDF numerado correlativo por cooperativa.
  - QR que lleva a una página de verificación pública mínima: "Recibo N° 123 válido, $ X, fecha", sin datos personales.
  - Se envía por email o WhatsApp.
- **Anular pago:** se registra con motivo y genera una anulación del recibo, nunca un borrado. Notifica a la Fiscal.
- **Convenios:**
  - Reemplazar el `DELETE` por **anulación lógica** con motivo.
  - **Simulador** (deuda, cuotas, recargo).
  - **Seguimiento de cumplimiento**, con alerta si se impaga una cuota del convenio.

### 8.4 Finanzas: confiable como un libro (resuelve D11)
- **Cuentas** (banco o caja) y **fondos** (obra o préstamo, social, reserva, mantenimiento, caja chica). Cada movimiento tiene cuenta y fondo, y hay saldos por cada uno.
- **Conciliación bancaria:**
  - Importar CSV o Excel con un **mapeo de columnas guardado por banco**.
  - Emparejamiento: (1) código de pago exacto → (2) monto más fecha ±3 días → (3) sugerencia.
  - Confirmación humana. Opcional: autoconfirmar coincidencias exactas por código.
  - Pendientes visibles; saldo conciliado contra saldo del sistema.
- **Cierre mensual:**
  - Estados `abierto → cerrado (tesorería) → visado (Fiscal)`.
  - Los movimientos con fecha en un período cerrado **quedan bloqueados a nivel de base de datos** (trigger).
  - Las correcciones se hacen con **contra-movimiento** en el período abierto.
- **Flujo de caja proyectado** a 30, 60 y 90 días: cuotas esperadas, compromisos, facturas a pagar y desembolsos esperados.
- **Préstamo de vivienda:** desembolsos esperados y recibidos, y en Habitada la amortización. Avance físico contra financiero en Obra.
- **Capital social y egreso:** partes sociales y, si el reglamento lo prevé, valorización de horas como aporte, base para la **liquidación de egreso** (borrador).
- **Exportación para el contador** en Excel: libro de movimientos con un plan de cuentas simple mapeable. **No construir contabilidad completa.**
- **Gasto menor o compra formal:** reglas claras en la interfaz (caja chica de comisión hasta un monto parametrizable; si supera ese monto, va por Compras). Ambos alimentan Finanzas.

**Qué ve cada rol en Finanzas:**

| Rol | Ve |
|---|---|
| Socio | Su saldo, cuotas, recibos, convenio, cómo pagar y **"¿En qué se gastó?"** (por rubro, sin datos personales) |
| Administración | Registrar pagos, emitir recibos, cargar facturas. No configura ni cierra |
| Tesorería | Todo lo operativo: banco, fondos, morosidad nominativa, convenios, compromisos, flujo y cierre |
| Consejo | Tablero ejecutivo: liquidez, disponible prudencial, flujo a 90 días, morosidad (porcentaje, monto y casos a decidir), ejecución presupuestal y compras a aprobar |
| Fiscal | Todo en lectura, más cambios sensibles, anulaciones, conciliaciones y visado de cierres |

### 8.5 Socios y padrón (resuelve D20)
- Estados: `aspirante → activo → suspendido → renunciante → excluido → egresado`, con fecha, motivo y quién lo hizo.
- **Antigüedad** calculada y **padrón exportable** (PDF y Excel).
- **Checklist de ingreso** para un socio nuevo: documentos, núcleo, usuario, bienvenida e inducción.
- **Directorio de oficios** (qué sabe hacer cada uno) para la Comisión de Trabajo.

### 8.6 Asambleas formales (resuelve D13)
- Tipo ordinaria o extraordinaria.
- **Plazos de convocatoria** según el estatuto (parámetros); el sistema calcula fechas mínimas y **avisa o bloquea** si no se cumplen.
- **Padrón habilitado** calculado según reglas parametrizables (por ejemplo, al día con las cuotas o antigüedad mínima), con la causa visible para cada socio inhabilitado.
- **Registro de asistencia**, y representación o poderes si el estatuto lo permite (parámetro).
- **Quórum en vivo** en primera y segunda convocatoria.
- **Votación por punto:** a favor, en contra, abstención, con conteo; nominal opcional.
- **Acta:** borrador automático con los datos registrados (en Fase 4, asistido por IA) → aprobación → PDF para el libro.
- **Resoluciones → tareas** automáticas (la trazabilidad ya existe; automatizar la creación).
- **Modo asamblea en vivo** (Fase 3): vista para proyector con quórum, punto actual y resultado de la votación.

### 8.7 Consejo, cargos y mandatos (resuelve D14)
- Cargos (presidente, secretario, tesorero, vocales, suplentes) y Comisión Fiscal, con **período de mandato**.
- **Los permisos se derivan del cargo vigente.** Al vencer el mandato se quitan los permisos sensibles, con aviso previo.
- Alerta de vencimiento de mandatos y **cronograma electoral** (Comisión Electoral).
- **Bandeja "Necesita decisión del Consejo"**: compras a aprobar, convenios propuestos, solicitudes, sanciones propuestas y temas escalados.
- **Orden del día automático** del Consejo con todo lo pendiente.

### 8.8 Comisiones como sistema de trabajo (resuelve D15)

**Común a todas las comisiones:**
- Plan del período: 3 a 5 objetivos.
- **Tareas** con estados `pendiente → en curso → bloqueada → en revisión → hecha / cancelada`.
  - Responsable único y colaboradores.
  - Fecha límite y prioridad.
  - **Evidencia** (foto, documento o link), obligatoria para cerrar según el tipo.
  - Comentarios con @menciones.
  - Origen (asamblea, reunión, solicitud, propia).
- **Orden del día automático:** vencidas, bloqueadas, solicitudes recibidas y decisiones pendientes.
- **Hilo de mensajes** de la comisión.
- **Solicitudes** a otras comisiones con plazo de respuesta, estado y escalamiento.
- **Informe mensual automático** para el Consejo y la asamblea.
- **KPIs comunes:**
  - Porcentaje de tareas en plazo.
  - Tareas vencidas.
  - Solicitudes respondidas en plazo.
  - Asistencia a reuniones.
  - Días sin actividad.

**Bloque propio por función** (en la pestaña Resumen y en su pestaña específica):

| Función | Herramienta propia | KPIs |
|---|---|---|
| Trabajo | Calendario (ya existe), **asistencia del día**, libreta de horas, faltas a justificar, núcleos en riesgo | Horas cumplidas sobre objetivo, núcleos al día, faltas injustificadas |
| Compras | Embudo solicitud → presupuestos → aprobación → OC → recepción → factura; **comparador**; proveedores con documentación vencida | Tiempo de compra, porcentaje con N presupuestos, desvío contra presupuesto, compras sin recepción |
| Seguridad | **Checklist diario**, inspecciones, incidentes abiertos, **EPP pendiente**, personas sin inducción | Días sin incidentes, observaciones corregidas en plazo |
| Administrativa | Correspondencia (entrada y salida), vencimientos documentales, libros al día, altas y bajas en trámite, plantillas | Documentos vencidos, atraso de actas |
| Obra | Avance por rubro, diario con fotos, hitos | Avance físico contra planificado y contra financiero |
| Fiscal | Cambios sensibles, cierres a visar, anomalías | Cierres visados, observaciones abiertas |
| Electoral | Padrón, cronograma, listas | — |
| Mantenimiento (Habitada) | Solicitudes, preventivo, gasto contra fondo | Tiempo de resolución |
| General / Fomento | Actividades, participación | Participación |

La estructura tiene que ser **reutilizable**: agregar una función nueva significa registrar su bloque en el catálogo `FUNCION_COMISION`, no reescribir la página.

### 8.9 Compras y proveedores
- Regla de montos: si supera X, exige N presupuestos y aprobación de quien corresponda (parámetros).
- **Comparador** de presupuestos lado a lado.
- **Orden de compra**, y **recepción** contra la OC con foto del remito y diferencias.
- Factura con **vencimiento de pago** y estado.
- Proveedor:
  - RUT y rubro.
  - **Documentación con vencimiento** (certificados, seguro), con aviso al elegir un proveedor con documentación vencida.
  - Historial de precios y evaluación simple.

### 8.10 Seguridad
- Checklist diario en el celular; cada ítem no cumplido genera una tarea.
- **EPP entregado por persona**, con constancia.
- **Inducción obligatoria:** sin inducción no se le asignan horas de obra (aviso o bloqueo según parámetro).
- Incidente → aviso a Seguridad y al Consejo, y tarea de investigación.

### 8.11 Calendario único
- Capas: reuniones, asambleas, actividades, turnos de obra, vencimientos de cuotas, vencimientos de documentos y reservas. Cada usuario prende o apaga capas.
- **Link ICS personal** para Google Calendar o el celular.
- Vista en **lista simple** por defecto para el socio ("Próximos 7 días").

### 8.12 Avisos, mensajes y notificaciones (resuelve D3 y D16)
- **Avisos:** difusión oficial con destinatarios (todos, una comisión, morosos, un núcleo), **constancia de envío y lectura**.
- **Mensajes:** hilos por comisión o tema.
- **Canales:** in-app y email (ya existen), y **WhatsApp**:
  - Primero, links `wa.me` y plantillas con difusión asistida.
  - Después, WhatsApp Business API con plantillas aprobadas.
- **Preferencias por usuario:** canal y frecuencia (inmediato o resumen diario o semanal).
- **Resumen semanal** los lunes por rol.

### 8.13 Documentos
- Se mantiene lo existente: categorías, versiones, vencimientos y vínculo con el socio.
- **Plantillas** con variables (`{socio}`, `{nucleo}`, `{fecha}`, `{monto}`) para constancias, notas, convocatorias y actas → PDF.
- **Libros sociales** dentro de Documentos, con acceso directo desde Asambleas y Consejo.
- Búsqueda en el contenido.
- Archivos privados con URLs firmadas y rutas por organización.

### 8.14 Control y transparencia (resuelve D4)
- Pestañas según el rol:
  - **Transparencia** (socio).
  - **Auditoría** (Fiscal, admin; coordinador solo de su comisión).
  - **Cumplimiento** (vencimientos y obligaciones).
  - **Panel Fiscal**.
- **Alertas a la Fiscal** por cambios sensibles: edición o anulación de pagos, movimientos o convenios.
- **Exportación** de la auditoría a Excel.

### 8.15 Reglamento parametrizado (resuelve D21)

Una sola pantalla, **"Reglamento de la cooperativa"**, con secciones y explicación en lenguaje simple de cada parámetro:

- **Horas:**
  - Objetivo semanal por núcleo (default 21).
  - Horario de obra y descanso.
  - Si computan las justificadas.
  - Umbrales de deuda y pasos.
  - Quién puede hacer horas.
- **Cuotas:**
  - Conceptos.
  - Día de generación.
  - Vencimiento.
  - Gracia.
  - Recargo.
  - Cantidad de cuotas para alerta o convenio.
- **Compras:**
  - Montos que exigen N presupuestos y quién aprueba.
  - Tope de caja chica.
- **Asambleas:**
  - Plazos de convocatoria.
  - Quórum en primera y segunda convocatoria.
  - Reglas de padrón habilitado.
  - Representación.
- **Seguridad:** inducción obligatoria (aviso o bloqueo).
- **Contacto de ayuda:** teléfono y horario.

### 8.16 Dashboard por rol (resuelve D8)

Estructura fija:

1. Saludo y fecha.
2. **Alertas críticas** (máximo 3, con botón de acción).
3. **"Lo que necesita tu atención"** (acciones, no números).
4. **Máximo 4 indicadores** del rol.
5. **Próximos 7 días.**
6. **Novedades oficiales.**

| Rol | Mostrar | NO mostrar |
|---|---|---|
| Socio | **Saldo y próxima cuota (grande)**, horas de la semana, próxima asamblea o reunión, avisos, botón "Cómo pagar" | Morosidad general, auditoría, métricas de comisiones |
| Integrante | Mis tareas, próxima reunión de mi comisión, solicitudes que me esperan | Finanzas globales |
| Coordinador | Lo anterior + estado de su comisión + bloque de su función (por ejemplo, asistencia de hoy) | Detalle de otras comisiones |
| Tesorería | Pagos del banco por revisar, facturas a pagar, cuotas atrasadas, disponible y flujo a 60 días | Tareas de obra |
| Consejo | **Bandeja "Necesita decisión"**, semáforo de salud, liquidez, comisiones atrasadas, hitos | Detalle operativo |
| Fiscal | Cambios sensibles, cierres a visar, anomalías | Tareas operativas |
| Admin | Configuración incompleta, usuarios pendientes, envíos fallidos | — |

Todo filtrado por **etapa** y **módulos activos**.

### 8.17 Portal del socio "Mi vivienda" (resuelve D9)

Pantalla de inicio del socio, móvil primero:

```
Hola, Rosa                                   lunes 12 de octubre
┌──────────────────────────────────────────────────────────┐
│  LO QUE DEBÉS HOY            $ 12.500                     │
│  Próxima cuota: vence el viernes 16 de octubre            │
│  [ Cómo pagar ]   [ Ver mis recibos ]                     │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  TUS HORAS ESTA SEMANA       15 de 21 h — te faltan 6 h   │
│  Próximo turno: sábado 17, 7:00 a 12:00 hs                │
│  [ Avisar que no puedo ir ]                               │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  PRÓXIMA ASAMBLEA   sábado 24 de octubre, 10:00 hs        │
│  Temas: presupuesto 2027, compra de terreno   [ Ver ]     │
└──────────────────────────────────────────────────────────┘
  AVISOS (2 nuevos)  ·  ¿EN QUÉ ESTAMOS? (línea de tiempo)
  ¿Necesitás ayuda? Llamá al 099 123 456
```

- Botón **"¿Por qué debo esto?"**, que explica en lenguaje simple el detalle del saldo: cuotas, recargos y convenio.
- Todo imprimible.

---

## 9. MOTOR DE AUTOMATIZACIONES ("Si → Entonces")

Un **único motor** con reglas predefinidas que se activan, desactivan y parametrizan en "Reglas y avisos", más un **registro de ejecuciones**. Corren por cron (Vercel Cron o equivalente) o por evento.

| # | Si… | Entonces… | Fase |
|---|---|---|---|
| A1 | Llega el día de generación | Generar cuotas de los núcleos activos y avisar | 1 |
| A2 | Se registra un pago | Recibo PDF numerado → envío → ingreso en Finanzas (este último ya existe) | 1 |
| A3 | Faltan 3 días para el vencimiento de una cuota impaga | Recordatorio al socio | 1 |
| A4 | Pasan los días de gracia | Estado "vencida", recargo y aviso | 1 |
| A5 | Un núcleo acumula ≥ N cuotas vencidas | Alerta a tesorería, borrador de convenio y punto para el Consejo | 1 |
| A6 | Es jueves y un núcleo tiene menos horas planificadas que su objetivo | Aviso al núcleo y al coordinador | 1 |
| A7 | Fin de semana | Cierre de horas: planificado contra asistido y saldo | 1 |
| A8 | Se cierra una reunión o asamblea | Resoluciones → tareas con responsable y plazo | 1 |
| A9 | Se importa un extracto bancario | Emparejamiento y propuestas de imputación | 2 |
| A10 | Se crea una asamblea | Fechas de convocatoria, envío, recordatorios y padrón habilitado | 2 |
| A11 | Se edita o anula un pago o movimiento | Notificación a la Fiscal | 1 |
| A12 | Una tarea vence mañana / ya venció | Recordatorio / escalamiento al coordinador | 1 |
| A13 | Un documento vence en 30 días | Alerta y tarea de renovación | 1 |
| A14 | Una solicitud de compra supera X | Exigir N presupuestos y aprobación | 2 |
| A15 | Se aprueba una compra | Compromiso en Finanzas (disponible prudencial) | 2 |
| A16 | Se carga una factura | Egreso, cierre del compromiso y recordatorio de pago | 2 |
| A17 | Se impaga una cuota de un convenio | Incumplimiento, aviso y punto para el Consejo | 2 |
| A18 | Un rubro supera el 90 % del presupuesto | Alerta a tesorería y Consejo | 2 |
| A19 | El disponible proyectado a 60 días da negativo | Alerta de liquidez | 2 |
| A20 | Es lunes a las 8:00 | Resumen semanal por rol | 2 |
| A21 | Se registra un incidente | Aviso a Seguridad y Consejo, y tarea de investigación | 1 |
| A22 | Inspección con observaciones | Tareas correctivas | 3 |
| A23 | Alta de un socio | Checklist de ingreso | 2 |
| A24 | Un mandato vence en 60 días | Recordatorio de elecciones | 2 |
| A25 | Deuda de horas supera X | Paso del reglamento **propuesto** (requiere aprobación) | 3 |
| A26 | Un rol sensible pasa 60 días sin entrar | Aviso al admin y propuesta de desactivación | 2 |
| A27 | Hito de trámite vencido (Pre-obra) | Aviso al responsable y al Consejo | 2 |
| A28 | Solicitud de mantenimiento sin respuesta en N días (Habitada) | Escalar a la comisión o al Consejo | 3 |

---

## 10. IA ÚTIL (Fase 4)

**Reglas de la IA:**
- Propone; una persona confirma.
- Respeta los permisos del usuario y el RLS.
- Muestra la fuente.
- Queda registrada en la auditoría.
- Nunca recibe datos de otra cooperativa.

| Función | Cómo |
|---|---|
| **Acta asistida** | Audio o notas → borrador con asistentes, puntos, resoluciones y responsables → tareas propuestas |
| **"Preguntale al reglamento"** | Búsqueda semántica sobre el estatuto, el reglamento y las actas de la cooperativa; responde **citando artículo o acta** |
| **Explicador de estado de cuenta** | "¿Por qué debo esto?" en lenguaje simple |
| **Lectura de facturas y presupuestos** | Foto o PDF → precarga del formulario (proveedor, RUT, fecha, ítems, total) |
| **Comparador de presupuestos** | Normaliza ítems y marca diferencias |
| **Resumen semanal personalizado** | Por rol y en lenguaje simple |
| **Consultas en lenguaje natural** | De solo lectura, con permisos del usuario; muestra la tabla de origen |
| **Detección de anomalías** | Para la Fiscal: duplicados, egresos fuera de patrón, cambios en períodos cerrados |
| **Memoria anual para asamblea** | Borrador con finanzas, obra, comisiones, horas y decisiones |
| **Redactor de avisos** | Versión para mail y versión corta para WhatsApp, en lenguaje claro |

**No hacer:** predecir "quién va a dejar de pagar" para mostrarlo al Consejo (riesgo de estigmatizar), ni dejar que la IA decida convenios, sanciones o pagos.

---

## 11. SEGURIDAD

### Ahora (Fases 1–2)
- **CI con GitHub Actions:**
  - Tests en cada push.
  - **Test de aislamiento multi-tenant:** se crean dos organizaciones y se intenta leer de forma cruzada en todas las tablas.
  - Verificación automática de que **toda tabla tiene RLS**.
- **2FA (TOTP)** obligatorio para admin, tesorería, Consejo y Fiscal.
- Límite de intentos en el login y en la recuperación de contraseña.
- Sesiones revocables y "cerrar sesión en todos los dispositivos".
- Permisos que vencen con el mandato.
- Archivos privados con URLs firmadas y expiración.
- **Backups con restauración probada** una vez por mes, y exportación completa por cooperativa.
- Quitar todo `DELETE` real sobre datos de negocio.
- Cierre de período con bloqueo en la base de datos.
- **Ley 18.331:**
  - Política de privacidad.
  - "Mis datos" para el titular.
  - Contrato de encargado de tratamiento con cada cooperativa.
  - Registro de la base ante la URCDP cuando corresponda.
- Dependabot y secretos solo en variables de entorno.

### Después (Fase 5)
- Prueba de penetración externa.
- Cifrado a nivel de campo para cédula y teléfono.
- Políticas de retención.
- Alertas de acceso inusual.
- Registro de quién vio cada ficha.
- SSO.
- Plan de respuesta a incidentes.

---

## 12. MULTI-TENANT SaaS

- **Membresías:** tabla (usuario, organización, rol) con **selector de cooperativa**, para técnicos de IAT, contadores y personas en varias cooperativas.
- **"Entrar como"** desde la plataforma (soporte), **visible en la auditoría de esa cooperativa**, con opción de requerir consentimiento.
- **Configuración en 3 capas:**
  - *Identidad:* nombre, logo, color, subdominio y remitente.
  - *Reglamento:* sección 8.15.
  - *Producto:* etapa, módulos, plan y límites.
- **Asistente de alta de cooperativa** (objetivo: operativa en menos de 1 día):
  1. Datos y modalidad (ayuda mutua o ahorro previo) y etapa.
  2. Reglamento con valores sugeridos.
  3. **Importador de socios y núcleos desde Excel** con plantilla descargable, vista previa y errores explicados en lenguaje simple.
  4. Comisiones sugeridas según la etapa.
  5. Invitación a usuarios.
  6. Checklist "Tu cooperativa está lista".
- **Plantillas de alta:** "Ayuda mutua – Pre-obra", "Ayuda mutua – Obra", "Ahorro previo", "Habitada". Precargan comisiones con su función, reglas, categorías de documentos y plantillas de texto.
- **Portabilidad:** exportación completa (Excel más archivos) en cualquier momento.
- Baja de cooperativa: baja lógica, retención y eliminación según contrato.
- Observabilidad y límites por organización (usuarios, almacenamiento, mensajes de WhatsApp).

---

## 13. REPORTES

**Regla:** PDF para lo oficial (se firma, se entrega, se archiva o va a asamblea); Excel para analizar o mandar al contador.

| Reporte | PDF | Excel |
|---|---|---|
| Estado de cuenta del núcleo | ✔ | |
| Recibo de pago | ✔ | |
| Constancia de socio / de horas | ✔ | |
| Libreta de horas del núcleo | ✔ | ✔ |
| Horas por núcleo (semana o mes) | ✔ | ✔ |
| Cuotas atrasadas (morosidad nominativa) | ✔ | ✔ |
| Cobranza del mes | | ✔ |
| Conciliación bancaria | ✔ | ✔ |
| Cierre mensual por fondo | ✔ | |
| Presupuesto contra real | ✔ | ✔ |
| Flujo de caja proyectado | | ✔ |
| Libro de movimientos para el contador | | ✔ |
| Convenios y cumplimiento | | ✔ |
| Compras del período con presupuestos | | ✔ |
| Proveedores y documentación vigente | | ✔ |
| Informe mensual de comisión | ✔ | |
| Seguimiento de resoluciones | ✔ | |
| Convocatoria, padrón habilitado y acta | ✔ | ✔ (padrón) |
| Memoria y balance anual | ✔ | |
| Padrón de socios | ✔ | ✔ |
| Seguridad (incidentes e inspecciones) | ✔ | |
| Avance de obra contra desembolsos | ✔ | ✔ |
| Auditoría de cambios sensibles | | ✔ |
| Estado de trámites e hitos (Pre-obra) | ✔ | |
| Mantenimiento y fondo (Habitada) | ✔ | ✔ |

---

## 14. PLAN DE TRABAJO POR FASES

> **Trabajá una fase por vez.** Al empezar cada fase:
> 1. Explorá el código relacionado.
> 2. Presentá un plan corto: qué vas a cambiar, migraciones y riesgos.
> 3. Implementá.
> 4. Probá.
> 5. Reportá.
>
> **Pedí confirmación antes de aplicar migraciones en producción o hacer deploy.** No pases a la fase siguiente sin que el usuario lo apruebe.

### FASE 1 — Fundamental: "confiable y usada por el socio"
1. CI (GitHub Actions), test de aislamiento multi-tenant, verificación de RLS en todas las tablas y corrección de los errores críticos de eslint.
2. Quitar el `DELETE` de convenios → anulación lógica. Buscar y eliminar cualquier otro `DELETE` sobre datos de negocio.
3. **Estándar de accesibilidad** (sección 5): tokens de tipografía y contraste, interruptor "Letra grande" y glosario aplicado.
4. **Núcleo como entidad central** (8.1).
5. **Modelo único de horas** (8.2): asistencia, justificación, saldo, libreta, migración de `jornadas_trabajo` y `horas_acumuladas`, alternativa sin arrastre y redirección de `/trabajo`.
6. **Cuotas automáticas, recargos, código de pago y recibo automático** (8.3).
7. **Reglamento parametrizado** (8.15), versión inicial con horas, cuotas y contacto de ayuda.
8. **Portal "Mi vivienda"** (8.17) y ingreso por link mágico para socios.
9. **Menú por rol** (7.1) con redirecciones (7.2) y **dashboard por rol** (8.16).
10. Motor de reglas base con A1–A8, A11–A13 y A21.
11. 2FA para roles sensibles y backups con restauración probada.

**Criterio de salida:**
- Las cinco tareas de usabilidad de 5.5 se completan en menos de 60 segundos.
- Hay un único número de horas por núcleo.
- Las cuotas y los recibos salen sin intervención manual.
- Todos los tests pasan en CI.

### FASE 2 — Profesional: "el tesorero y la Fiscal confían"
1. Cuentas y fondos, **conciliación bancaria** y **cierre mensual** con bloqueo y visado.
2. Flujo de caja proyectado y exportación para el contador.
3. **Socios:** ciclo de vida, padrón con antigüedad y aspirantes.
4. **Asambleas formales** (8.6).
5. **Consejo, cargos y mandatos**, bandeja "Necesita decisión" y orden del día automático (8.7).
6. **Trámites e hitos** (Pre-obra) con línea de tiempo "¿En qué estamos?" para el socio.
7. **Avisos y mensajes** unificados, WhatsApp v1 (links y plantillas), preferencias y resumen semanal.
8. **Unificación de duplicados:** Directorio, Control y transparencia, Reglas y avisos, calendario único con ICS.
9. Compras: regla de montos y comparador. Proveedores con documentación vigente.
10. **Asistente de alta de cooperativa**, importador Excel y plantillas por modalidad y etapa.
11. Reportes PDF y Excel (sección 13).
12. Automatizaciones A9, A10, A14–A20, A23, A24, A26 y A27.

**Criterio de salida:**
- El cierre mensual tarda menos de 2 horas.
- La Fiscal revisa el mes sin pedir planillas.
- Una cooperativa nueva queda operativa en menos de 1 día.

### FASE 3 — Diferenciación: "lo que nadie más tiene"
1. Asistencia por **QR** en obra.
2. **Paneles propios por función de comisión** (8.8): Compras, Seguridad, Administrativa, Obra, Fiscal, Electoral y Mantenimiento.
3. Recepción de materiales, **pañol** y **diario de obra con fotos**.
4. **Avance físico contra financiero** y desembolsos del préstamo.
5. Seguridad: checklist diario, EPP e inducción obligatoria.
6. **Modo asamblea en vivo.**
7. **Acceso delegado** para familiares.
8. **Etapa Habitada v1:** conceptos de cuota, mantenimiento, reservas de espacios comunes y liquidación de egreso.
9. Asistente "Cambiar de etapa".
10. Semáforo de salud cooperativa, encuestas rápidas y directorio de oficios.
11. Automatizaciones A22, A25 y A28.

**Criterio de salida:** las comisiones de Trabajo, Compras y Seguridad de los pilotos dejan las planillas y sus grupos propios.

### FASE 4 — IA y automatización: "el sistema trabaja solo"
1. Motor de reglas completo, con registro de ejecuciones y parámetros editables.
2. IA (sección 10): acta asistida, "Preguntale al reglamento", explicador de estado de cuenta, lectura de facturas, comparador, resumen semanal, consultas en lenguaje natural, anomalías y memoria anual.

**Criterio de salida:** reducción medible de las horas que el Consejo y la tesorería dedican a tareas administrativas.

### FASE 5 — Escalabilidad: "de producto a plataforma"
1. Membresías multi-organización y **portal del IAT**.
2. WhatsApp Business API.
3. Pagos online (red de cobranza o pasarela) y e-Factura.
4. Etapa Habitada completa.
5. API de solo lectura.
6. Benchmark anónimo entre cooperativas.
7. Facturación SaaS y centro de ayuda.
8. Seguridad avanzada (sección 11, "Después").

**Criterio de salida:** más de 20 cooperativas activas, con alta sin intervención del equipo.

---

## 15. DEFINICIÓN DE "TERMINADO" (para cada tarea)

- [ ] Funciona en escritorio y en celular (375 px de ancho).
- [ ] Cumple la lista de la **sección 5** (accesibilidad y lenguaje).
- [ ] Respeta permisos (matriz más comisión), validados en el servidor.
- [ ] Respeta la etapa y los módulos activos.
- [ ] Migración no destructiva, con RLS y sin DELETE para `app_user`.
- [ ] Auditado, con texto legible en `auditoriaTexto.ts`.
- [ ] Sin borrados reales; solo anulación o baja lógica.
- [ ] Tests automatizados con casos felices, permisos denegados, aislamiento entre organizaciones y casos borde (semana sin horas, cuota duplicada, período cerrado).
- [ ] Rutas viejas redirigen; ninguna función existente se perdió.
- [ ] `CHANGELOG.md` actualizado en lenguaje simple.
- [ ] Probado contra una organización de prueba, **nunca contra datos de Ufama**.
- [ ] Reporte final al usuario: qué se hizo, cómo probarlo, qué queda pendiente y si hace falta aplicar una migración o hacer deploy (pidiendo permiso).

---

## 16. ERRORES QUE NO DEBÉS COMETER

1. Agregar módulos nuevos antes de consolidar los duplicados.
2. Diseñar solo para el Consejo y olvidarte del socio.
3. Crear otra fuente de verdad para horas, tareas, saldos o calendario.
4. Dejar que la IA decida algo.
5. Permitir editar el pasado financiero.
6. Construir contabilidad completa: exportar al contador alcanza.
7. Hacer código específico para una cooperativa en lugar de parametrizar el reglamento.
8. Prometer validez legal (votación electrónica vinculante, firma digital) sin respaldo validado.
9. Escalar sin CI, sin backups probados y sin test de aislamiento.
10. Usar jerga, íconos sin texto, gris claro o acciones que solo se hacen arrastrando.
11. Mostrar en el dashboard cosas que no corresponden al rol o a la etapa.
12. Borrar datos, renombrar columnas en uso o romper rutas existentes.

---

## 17. CÓMO EMPEZAR

1. Leé el repositorio:
   - `Nav.tsx`, `roles.ts`, `comisionAuth.ts`.
   - `logic.ts`, `horasObra.ts`, `horasTrabajo.ts`, `comisionesFunciones.ts`, `comisionesResumen.ts`.
   - `actions/*`.
   - `migrations/`.
   - Páginas de `dashboard`, `socios`, `finanzas`, `comisiones`, `trabajo`, `asambleas`.
2. Confirmá cómo está implementado hoy cada punto del diagnóstico (sección 4) y corregí este prompt si algo no coincide con el código real.
3. Presentá el **plan detallado de la Fase 1**: tareas en orden, migraciones (desde la `0051` en adelante), archivos a tocar, riesgos y cómo vas a probar.
4. Esperá la aprobación y recién ahí empezá a implementar.
