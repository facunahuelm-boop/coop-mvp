import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import dayjs from "dayjs";
import { getCurrentUser } from "@/lib/auth";
import { leerDetalleCooperativa } from "@/lib/plataformaCoop";
import { leerVistaPreviaLimpieza } from "@/lib/plataformaLimpieza";
import { Card, PageHeader, Badge, StatTile, EmptyState } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import { TablaFiltrable } from "@/components/TablaFiltrable";
import { PLAN_LABELS, type Plan } from "@/lib/planes";
import {
  EditarCooperativaForm,
  NucleoForm,
  CargarNucleosLoteForm,
  BajaNucleoBoton,
  IntegrantesBoton,
  UsuarioForm,
  EstadoCuentaBadge,
  CambiarActivoUsuarioBoton,
  InvitarUsuarioBoton,
  CrearUsuariosParaNucleosBoton,
  CargarComisionesLoteForm,
  LimpiezaForm,
  VaciarDatosForm,
  RestaurarRespaldoBoton,
} from "@/components/plataforma/CooperativaAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ETAPA_LABEL: Record<string, string> = { pre_obra: "Pre-obra", obra: "En obra", habitada: "Habitada" };

const th = "text-left text-xs font-semibold text-ink-muted border-b border-border py-2 pr-3";
const td = "py-2 pr-3 border-b border-border/60 align-middle";

/**
 * Administración de UNA cooperativa desde el panel de plataforma: núcleos con
 * su numeración real, integrantes, usuarios (con estado pendiente/activo),
 * comisiones y limpieza de datos de prueba con respaldo. Solo el
 * administrador de la plataforma (mismo gate que /plataforma); cada cambio
 * queda en la auditoría de la cooperativa administrada.
 */
export default async function CooperativaAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.es_platform_admin) redirect("/dashboard");

  const orgId = Number((await params).id);
  if (!Number.isInteger(orgId) || orgId <= 0) notFound();
  const detalle = await leerDetalleCooperativa(orgId);
  if (!detalle) notFound();
  const vistaLimpieza = await leerVistaPreviaLimpieza(orgId);

  const { org, nucleos, usuarios, comisiones } = detalle;
  const nombreComision = new Map(comisiones.map((c) => [c.id, c.nombre]));
  const usuarioDeNucleo = new Map(usuarios.filter((u) => u.socio_id).map((u) => [u.socio_id as number, u]));
  const pendientes = usuarios.filter((u) => u.activo && u.estado_cuenta === "pendiente");
  const sinUsuario = nucleos.filter((n) => !n.user_id).length;
  const opcionesComision = comisiones.filter((c) => c.activa).map((c) => ({ value: String(c.id), label: c.nombre }));

  // ---- Núcleos ----
  const filasNucleos = nucleos.map((n) => {
    const u = usuarioDeNucleo.get(n.socio_id);
    return (
      <tr key={n.socio_id}>
        <td className={`${td} font-semibold`}>{n.numero_nucleo ?? "—"}</td>
        <td className={td}>
          <p className="font-medium text-ink">{n.nombre}</p>
          {(n.documento || n.telefono) && <p className="text-xs text-ink/50">{[n.documento, n.telefono].filter(Boolean).join(" · ")}</p>}
        </td>
        <td className={td}>{u ? <span className="text-sm">{u.nombre}</span> : <span className="text-xs text-ink/40">Sin usuario</span>}</td>
        <td className={td}>{n.integrantes.filter((i) => i.estado === "activo").length}</td>
        <td className={`${td} text-right`}>
          <div className="flex flex-wrap justify-end gap-1.5">
            <IntegrantesBoton orgId={orgId} nucleo={n} />
            <NucleoForm orgId={orgId} nucleo={n} />
            <BajaNucleoBoton orgId={orgId} nucleo={n} />
          </div>
        </td>
      </tr>
    );
  });
  const tabNucleos = (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-ink/60">{nucleos.length} núcleo{nucleos.length === 1 ? "" : "s"} en el padrón activo.</p>
        <div className="flex flex-wrap gap-2">
          <CargarNucleosLoteForm orgId={orgId} />
          <NucleoForm orgId={orgId} />
        </div>
      </div>
      {nucleos.length === 0 ? (
        <EmptyState>Todavía no hay núcleos. Agregá uno con el botón de arriba, o pegá la lista completa con «Cargar lista de núcleos».</EmptyState>
      ) : (
        <TablaFiltrable
          placeholder="Buscar por nombre o N.º de núcleo…"
          claves={nucleos.map((n) => `${n.numero_nucleo ?? ""} nucleo ${n.nombre} ${n.documento ?? ""} ${usuarioDeNucleo.get(n.socio_id)?.nombre ?? ""}`)}
          filtros={[
            {
              id: "comision",
              label: "Comisión",
              opciones: opcionesComision,
              valores: nucleos.map((n) => (usuarioDeNucleo.get(n.socio_id)?.comision_ids ?? []).map(String)),
            },
            {
              id: "usuario",
              label: "Usuario",
              opciones: [
                { value: "con", label: "Con usuario" },
                { value: "sin", label: "Sin usuario" },
              ],
              valores: nucleos.map((n) => (n.user_id ? "con" : "sin")),
            },
          ]}
          porPagina={30}
          encabezado={
            <tr>
              <th className={th}>N.º</th>
              <th className={th}>Persona de referencia</th>
              <th className={th}>Usuario</th>
              <th className={th}>Integrantes</th>
              <th className={`${th} text-right`}>Acciones</th>
            </tr>
          }
        >
          {filasNucleos}
        </TablaFiltrable>
      )}
    </div>
  );

  // ---- Usuarios ----
  const estadoDe = (u: (typeof usuarios)[number]) => (!u.activo ? "desactivada" : u.estado_cuenta === "pendiente" ? "pendiente" : "activa");
  const filasUsuarios = usuarios.map((u) => (
    <tr key={u.id} className={!u.activo ? "opacity-60" : ""}>
      <td className={td}>
        <p className="font-medium text-ink">
          {u.nombre} {u.es_platform_admin && <Badge color="azul">Plataforma</Badge>}
        </p>
        <p className="text-xs text-ink/50">{u.email ?? "Sin email todavía"}</p>
      </td>
      <td className={td}>{u.numero_nucleo ? `N.º ${u.numero_nucleo}` : <span className="text-xs text-ink/40">—</span>}</td>
      <td className={td}>
        {u.comision_ids.length ? (
          <div className="flex flex-wrap gap-1">
            {u.comision_ids.map((id) => (
              <Badge key={id}>{nombreComision.get(id) ?? "—"}</Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-ink/40">—</span>
        )}
      </td>
      <td className={td}>
        <EstadoCuentaBadge u={u} />
      </td>
      <td className={`${td} text-right`}>
        <div className="flex flex-wrap justify-end gap-1.5">
          <UsuarioForm orgId={orgId} usuario={u} nucleos={nucleos} comisiones={comisiones} />
          <InvitarUsuarioBoton orgId={orgId} usuario={u} />
          {!u.es_platform_admin && u.id !== user.id && <CambiarActivoUsuarioBoton orgId={orgId} usuario={u} />}
        </div>
      </td>
    </tr>
  ));
  const tabUsuarios = (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-ink/60">
          {usuarios.length} usuario{usuarios.length === 1 ? "" : "s"}
          {pendientes.length > 0 && <> · <b>{pendientes.length}</b> pendiente{pendientes.length === 1 ? "" : "s"} de activación</>}
        </p>
        <div className="flex flex-wrap gap-2">
          {sinUsuario > 0 && <CrearUsuariosParaNucleosBoton orgId={orgId} sinUsuario={sinUsuario} />}
          <UsuarioForm orgId={orgId} nucleos={nucleos} comisiones={comisiones} />
        </div>
      </div>
      {usuarios.length === 0 ? (
        <EmptyState>Todavía no hay usuarios. Agregá uno con el botón de arriba.</EmptyState>
      ) : (
        <TablaFiltrable
          placeholder="Buscar por nombre, email o N.º de núcleo…"
          claves={usuarios.map((u) => `${u.nombre} ${u.email ?? ""} ${u.numero_nucleo ?? ""}`)}
          filtros={[
            { id: "comision", label: "Comisión", opciones: opcionesComision, valores: usuarios.map((u) => u.comision_ids.map(String)) },
            {
              id: "estado",
              label: "Estado",
              opciones: [
                { value: "activa", label: "Activa" },
                { value: "pendiente", label: "Pendiente de activación" },
                { value: "desactivada", label: "Desactivada" },
              ],
              valores: usuarios.map(estadoDe),
            },
          ]}
          porPagina={30}
          encabezado={
            <tr>
              <th className={th}>Usuario</th>
              <th className={th}>Núcleo</th>
              <th className={th}>Comisiones</th>
              <th className={th}>Estado</th>
              <th className={`${th} text-right`}>Acciones</th>
            </tr>
          }
        >
          {filasUsuarios}
        </TablaFiltrable>
      )}
    </div>
  );

  // ---- Comisiones ----
  const tabComisiones = (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-ink/60">Para cambiar a alguien de comisión, editá su usuario (pestaña Usuarios).</p>
        <CargarComisionesLoteForm orgId={orgId} />
      </div>
      {comisiones.length === 0 ? (
        <EmptyState>Todavía no hay comisiones. Usá «Cargar comisiones» y tildá «Crear las comisiones que falten».</EmptyState>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {comisiones.map((c) => (
            <Card key={c.id} className={!c.activa ? "opacity-60" : ""}>
              <p className="text-sm font-semibold text-[var(--color-brand-900)]">
                {c.nombre} {!c.activa && <Badge color="gray">Archivada</Badge>}
              </p>
              <p className="text-xs text-ink/50 mb-2">
                {c.miembros.length} integrante{c.miembros.length === 1 ? "" : "s"}
              </p>
              {c.miembros.length === 0 ? (
                <p className="text-xs text-ink/40">Sin integrantes.</p>
              ) : (
                <ul className="text-sm space-y-0.5">
                  {c.miembros.map((m) => (
                    <li key={m.user_id}>
                      {m.nombre}
                      {m.numero_nucleo ? <span className="text-xs text-ink/40"> · N.º {m.numero_nucleo}</span> : <span className="text-xs text-ink/40"> · sin núcleo</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // ---- Limpieza ----
  const tabLimpieza = (
    <div className="space-y-4">
      <Card className="bg-[var(--color-brand-50)] border-[var(--color-brand-100)]">
        <p className="text-sm text-ink/80">
          Herramienta para dejar atrás los datos de prueba. <b>Primero guarda un respaldo completo</b>, después da de baja lo que elijas. Nunca toca otras cooperativas, a los administradores, ni
          documentos, finanzas o asambleas. Nada se borra: los usuarios y los núcleos pasan a baja y dejan de verse en todo el sistema, y se pueden restaurar desde el respaldo.
        </p>
      </Card>
      <LimpiezaForm orgId={orgId} vista={vistaLimpieza} />
      <div className="mt-4"><VaciarDatosForm orgId={orgId} /></div>
      <section>
        <h3 className="text-sm font-semibold text-ink/70 mb-1">Respaldos guardados</h3>
        {vistaLimpieza.respaldos.length === 0 ? (
          <p className="text-xs text-ink/50">Todavía no se hizo ninguna limpieza.</p>
        ) : (
          <ul className="space-y-1">
            {vistaLimpieza.respaldos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm rounded-lg border border-border px-3 py-2">
                <span>
                  Respaldo n.º {r.id} · {dayjs(r.creado_en).format("DD/MM/YYYY HH:mm")} · {r.cantidad_registros} registros
                </span>
                <span className="flex items-center gap-3">
                  <a href={`/api/plataforma/respaldo?org=${orgId}&id=${r.id}`} className="text-xs font-semibold underline text-[var(--color-brand-800)]">
                    Descargar JSON
                  </a>
                  {r.restaurado ? <span className="text-xs text-ink/50">Restaurado</span> : <RestaurarRespaldoBoton orgId={orgId} respaldoId={r.id} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <div>
      <p className="mb-2">
        <Link href="/plataforma" className="text-xs underline text-[var(--color-brand-800)]">
          ← Panel de plataforma
        </Link>
      </p>
      <PageHeader
        title={org.nombre}
        subtitle={`/${org.slug} · ${ETAPA_LABEL[org.etapa] ?? org.etapa} · Plan ${PLAN_LABELS[org.plan as Plan] ?? org.plan}${org.activo ? "" : " · DESACTIVADA"}`}
        action={<EditarCooperativaForm orgId={orgId} nombre={org.nombre} etapa={org.etapa} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatTile label="Núcleos" value={String(nucleos.length)} />
        <StatTile label="Usuarios" value={String(usuarios.length)} />
        <StatTile label="Pendientes de activación" value={String(pendientes.length)} color={pendientes.length ? "amarillo" : undefined} />
        <StatTile label="Comisiones" value={String(comisiones.filter((c) => c.activa).length)} />
      </div>

      <Tabs
        tabs={[
          { id: "nucleos", label: `Núcleos (${nucleos.length})`, content: tabNucleos },
          { id: "usuarios", label: `Usuarios (${usuarios.length})`, content: tabUsuarios },
          { id: "comisiones", label: `Comisiones (${comisiones.length})`, content: tabComisiones },
          { id: "limpieza", label: "Limpieza de datos de prueba", content: tabLimpieza },
        ]}
      />
    </div>
  );
}
