"use client";

// Panel de administración por cooperativa (/plataforma/[id]). Mismos patrones
// del resto del sistema: FormularioEnModal para formularios cortos (un solo
// pop-up, "Volver" siempre visible, error arriba), BotonAccion para acciones
// de un toque. Todo guarda en la base real vía las acciones de
// actions/plataformaCooperativa.ts — no hay estado solo en el navegador.

import { useActionState, useEffect, useState } from "react";
import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import { Modal, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass, Badge } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import {
  editarCooperativaFormAction,
  guardarNucleoFormAction,
  darDeBajaNucleoFormAction,
  eliminarNucleoDefinitivoFormAction,
  cargarNucleosEnLoteFormAction,
  guardarIntegranteFormAction,
  cambiarEstadoIntegranteFormAction,
  guardarUsuarioFormAction,
  cambiarActivoUsuarioFormAction,
  crearUsuariosParaNucleosFormAction,
  invitarUsuarioPlataformaFormAction,
  cargarComisionesEnLoteFormAction,
  ejecutarLimpiezaPruebaFormAction,
  restaurarRespaldoLimpiezaFormAction,
  vaciarDatosPruebaFormAction,
  invitarNucleoFormAction,
} from "@/lib/actions/plataformaCooperativa";
import type { NucleoBajaFila, NucleoFila, UsuarioFila, ComisionFila, IntegranteFila } from "@/lib/plataformaCoop";
import type { VistaPreviaLimpieza } from "@/lib/plataformaLimpieza";

export const CLASE_BOTON_AGREGAR =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border-2 border-[var(--color-verde)] text-[var(--color-verde)] bg-transparent hover:bg-[var(--color-verde-bg)] transition-colors";
const CLASE_BOTON_CHICO =
  "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-sunken transition-colors";

const RELACION_LABEL: Record<string, string> = {
  pareja: "Pareja",
  hijo: "Hijo",
  hija: "Hija",
  padre: "Padre",
  madre: "Madre",
  hermano: "Hermano",
  hermana: "Hermana",
  otro: "Otro",
};

const ETAPA_LABEL: Record<string, string> = { pre_obra: "Pre-obra", obra: "En obra", habitada: "Habitada" };

// ---------------------------------------------------------------------------
// Cooperativa
// ---------------------------------------------------------------------------

export function EditarCooperativaForm({ orgId, nombre, etapa }: { orgId: number; nombre: string; etapa: string }) {
  return (
    <FormularioEnModal
      textoBoton="Editar cooperativa"
      titulo="Editar cooperativa"
      action={editarCooperativaFormAction}
      ocultos={{ org_id: orgId }}
      mensajeExito="Cooperativa actualizada."
    >
      <div>
        <Label required>Nombre de la cooperativa</Label>
        <input name="nombre" required data-validar="nombre" defaultValue={nombre} className={inputClass} />
      </div>
      <div>
        <Label required>Etapa</Label>
        <select name="etapa" defaultValue={etapa} className={inputClass}>
          {Object.entries(ETAPA_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink/50 mt-1">La etapa decide qué módulos ve la cooperativa en su menú.</p>
      </div>
    </FormularioEnModal>
  );
}

// ---------------------------------------------------------------------------
// Núcleos
// ---------------------------------------------------------------------------

export function NucleoForm({ orgId, nucleo }: { orgId: number; nucleo?: NucleoFila }) {
  const editando = !!nucleo;
  return (
    <FormularioEnModal
      textoBoton={editando ? "Editar" : "Agregar núcleo"}
      titulo={editando ? `Editar núcleo N.º ${nucleo.numero_nucleo ?? "—"}` : "Agregar núcleo"}
      descripcion={!editando ? "Cargá el número real del núcleo en la cooperativa y la persona de referencia." : undefined}
      action={guardarNucleoFormAction}
      ocultos={editando ? { org_id: orgId, socio_id: nucleo.socio_id } : { org_id: orgId }}
      mensajeExito={editando ? "Núcleo actualizado." : "Núcleo creado."}
      claseBoton={editando ? CLASE_BOTON_CHICO : CLASE_BOTON_AGREGAR}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label required>N.º de núcleo</Label>
          <input name="numero_nucleo" type="number" min={1} required defaultValue={nucleo?.numero_nucleo ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <Label required>Nombre de la persona de referencia</Label>
          <input name="nombre" required data-validar="nombre" defaultValue={nucleo?.nombre ?? ""} placeholder="Nombre y apellido" className={inputClass} />
        </div>
        <div>
          <Label>Documento</Label>
          <input name="documento" data-validar="documento" defaultValue={nucleo?.documento ?? ""} className={inputClass} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" data-validar="telefono" defaultValue={nucleo?.telefono ?? ""} className={inputClass} />
        </div>
        <div>
          <Label>Email</Label>
          <input name="email" type="email" defaultValue={nucleo?.email ?? ""} className={inputClass} />
        </div>
      </div>
      <p className="text-xs text-ink/50">Los datos que no tengas todavía se pueden completar después. No se inventa nada.</p>
    </FormularioEnModal>
  );
}

export function CargarNucleosLoteForm({ orgId }: { orgId: number }) {
  return (
    <FormularioEnModal
      textoBoton="Cargar lista de núcleos"
      titulo="Cargar lista de núcleos"
      descripcion="Pegá una línea por núcleo: el número y el nombre. Se respeta la numeración tal cual, sin renumerar."
      action={cargarNucleosEnLoteFormAction}
      ocultos={{ org_id: orgId }}
      textoConfirmar="Cargar núcleos"
      claseBoton={CLASE_BOTON_AGREGAR}
    >
      <div>
        <Label required>Lista (N.º y nombre)</Label>
        <textarea
          name="texto"
          required
          rows={10}
          placeholder={"4 Ernesto Rodríguez\n7 Daniel Bera\n14 Mercedes Álvarez"}
          className={`${inputClass} font-mono`}
        />
        <p className="text-xs text-ink/50 mt-1">
          Si algún número o nombre está repetido o mal escrito, no se carga ninguno y te decimos cuál línea corregir. Los que ya estaban cargados se omiten.
        </p>
      </div>
    </FormularioEnModal>
  );
}

export function BajaNucleoBoton({ orgId, nucleo }: { orgId: number; nucleo: NucleoFila }) {
  return (
    <FormularioEnModal
      textoBoton="Dar de baja"
      titulo="Dar de baja el núcleo"
      descripcion={
        <p>
          ¿Dar de baja el núcleo N.º {nucleo.numero_nucleo ?? "—"} ({nucleo.nombre})? Sale del padrón activo, pero no se borra nada: el historial queda guardado.
        </p>
      }
      action={darDeBajaNucleoFormAction}
      ocultos={{ org_id: orgId, socio_id: nucleo.socio_id }}
      textoConfirmar="Sí, dar de baja"
      peligro
      mensajeExito="Núcleo dado de baja."
      claseBoton={CLASE_BOTON_CHICO}
    />
  );
}

// ---------------------------------------------------------------------------
// Integrantes de un núcleo
// ---------------------------------------------------------------------------

function IntegranteCampos({ i }: { i?: IntegranteFila }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label required>Nombre</Label>
        <input name="nombre" required data-validar="nombre" defaultValue={i?.nombre ?? ""} className={inputClass} />
      </div>
      <div>
        <Label>Apellido</Label>
        <input name="apellido" defaultValue={i?.apellido ?? ""} className={inputClass} />
      </div>
      <div>
        <Label>Relación con la persona de referencia</Label>
        <select name="relacion" defaultValue={i?.relacion ?? "otro"} className={inputClass}>
          {Object.entries(RELACION_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Documento</Label>
        <input name="documento" data-validar="documento" defaultValue={i?.documento ?? ""} className={inputClass} />
      </div>
      <div>
        <Label>Teléfono</Label>
        <input name="telefono" data-validar="telefono" defaultValue={i?.telefono ?? ""} className={inputClass} />
      </div>
      <div>
        <Label>Email</Label>
        <input name="email" type="email" defaultValue={i?.email ?? ""} className={inputClass} />
      </div>
    </div>
  );
}

export function IntegrantesBoton({ orgId, nucleo }: { orgId: number; nucleo: NucleoFila }) {
  const [abierto, setAbierto] = useState(false);
  const activos = nucleo.integrantes.filter((i) => i.estado === "activo").length;
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={CLASE_BOTON_CHICO}>
        Integrantes ({activos})
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} title={`Núcleo N.º ${nucleo.numero_nucleo ?? "—"} · ${nucleo.nombre}`} size="lg">
        <div className="space-y-3 text-ink">
          <p className="text-xs text-ink/60">Personas que viven en este núcleo, además de la persona de referencia.</p>
          {nucleo.integrantes.length === 0 ? (
            <p className="text-sm text-ink/60">Todavía no hay integrantes cargados.</p>
          ) : (
            <ul className="divide-y divide-border">
              {nucleo.integrantes.map((i) => (
                <li key={i.id} className={`py-2 flex flex-wrap items-center justify-between gap-2 ${i.estado !== "activo" ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {i.nombre} {i.apellido ?? ""}
                    </p>
                    <p className="text-xs text-ink/50">
                      {RELACION_LABEL[i.relacion] ?? i.relacion}
                      {i.estado !== "activo" ? " · inactivo" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <FormularioEnModal
                      enLinea
                      textoBoton="Editar"
                      titulo={`Editar a ${i.nombre}`}
                      action={guardarIntegranteFormAction}
                      ocultos={{ org_id: orgId, socio_id: nucleo.socio_id, id: i.id }}
                      mensajeExito="Integrante actualizado."
                      claseBoton={CLASE_BOTON_CHICO}
                    >
                      <IntegranteCampos i={i} />
                    </FormularioEnModal>
                    <BotonAccion
                      action={cambiarEstadoIntegranteFormAction}
                      ocultos={{ org_id: orgId, id: i.id, estado: i.estado === "activo" ? "inactivo" : "activo" }}
                      mensajeExito={i.estado === "activo" ? "Integrante dado de baja." : "Integrante reactivado."}
                    >
                      {i.estado === "activo" ? "Dar de baja" : "Reactivar"}
                    </BotonAccion>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <FormularioEnModal
            enLinea
            textoBoton="Agregar integrante"
            titulo="Agregar integrante"
            action={guardarIntegranteFormAction}
            ocultos={{ org_id: orgId, socio_id: nucleo.socio_id }}
            mensajeExito="Integrante agregado."
            claseBoton={CLASE_BOTON_AGREGAR}
          >
            <IntegranteCampos />
          </FormularioEnModal>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export function EstadoCuentaBadge({ u }: { u: UsuarioFila }) {
  if (!u.activo) return <Badge color="rojo">Desactivada</Badge>;
  if (u.estado_cuenta === "pendiente") {
    if (!u.email) return <Badge color="amarillo">Falta email</Badge>;
    return <Badge color="amarillo">{u.invitacion_vigente ? "Invitación enviada" : "Sin invitar"}</Badge>;
  }
  return <Badge color="verde">Activa</Badge>;
}

export function UsuarioForm({
  orgId,
  usuario,
  nucleos,
  comisiones,
}: {
  orgId: number;
  usuario?: UsuarioFila;
  nucleos: NucleoFila[];
  comisiones: ComisionFila[];
}) {
  const editando = !!usuario;
  return (
    <FormularioEnModal
      textoBoton={editando ? "Editar" : "Agregar usuario"}
      titulo={editando ? `Editar a ${usuario.nombre}` : "Agregar usuario"}
      descripcion={
        !editando ? (
          <p>
            Se crea con rol «Socio» (sin privilegios) y queda <b>pendiente de activación</b> hasta que tenga email y elija su contraseña. Si la persona ya existe, editala en vez de crear otra cuenta.
          </p>
        ) : undefined
      }
      action={guardarUsuarioFormAction}
      ocultos={editando ? { org_id: orgId, id: usuario.id } : { org_id: orgId }}
      mensajeExito={editando ? "Usuario actualizado." : "Usuario creado."}
      claseBoton={editando ? CLASE_BOTON_CHICO : CLASE_BOTON_AGREGAR}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label required>Nombre y apellido</Label>
          <input name="nombre" required data-validar="nombre" defaultValue={usuario?.nombre ?? ""} className={inputClass} />
        </div>
        <div>
          <Label>Email</Label>
          <input name="email" type="email" defaultValue={usuario?.email ?? ""} placeholder="Se puede completar después" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <Label>Núcleo</Label>
          <select name="socio_id" defaultValue={usuario?.socio_id ?? ""} className={inputClass}>
            <option value="">Sin núcleo</option>
            {nucleos.map((n) => {
              const ocupado = !!n.user_id && n.user_id !== usuario?.id;
              return (
                <option key={n.socio_id} value={n.socio_id} disabled={ocupado}>
                  {n.numero_nucleo ? `N.º ${n.numero_nucleo} — ` : ""}
                  {n.nombre}
                  {ocupado ? " (ya tiene usuario)" : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-ink-muted mb-1">Comisiones (una o varias)</legend>
        {comisiones.filter((c) => c.activa).length === 0 ? (
          <p className="text-xs text-ink/50">Todavía no hay comisiones. Creálas desde «Cargar comisiones» en la pestaña Comisiones.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {comisiones
              .filter((c) => c.activa)
              .map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="comision_ids" value={c.id} defaultChecked={usuario?.comision_ids.includes(c.id) ?? false} />
                  {c.nombre}
                </label>
              ))}
          </div>
        )}
      </fieldset>
    </FormularioEnModal>
  );
}

export function CambiarActivoUsuarioBoton({ orgId, usuario }: { orgId: number; usuario: UsuarioFila }) {
  if (usuario.activo) {
    return (
      <FormularioEnModal
        textoBoton="Desactivar"
        titulo="Desactivar usuario"
        descripcion={<p>¿Desactivar a {usuario.nombre}? No va a poder entrar, pero su historial queda intacto y se puede reactivar cuando quieras.</p>}
        action={cambiarActivoUsuarioFormAction}
        ocultos={{ org_id: orgId, id: usuario.id }}
        textoConfirmar="Sí, desactivar"
        peligro
        mensajeExito="Usuario desactivado."
        claseBoton={CLASE_BOTON_CHICO}
      />
    );
  }
  return (
    <BotonAccion action={cambiarActivoUsuarioFormAction} ocultos={{ org_id: orgId, id: usuario.id, activo: "on" }} mensajeExito="Usuario reactivado.">
      Reactivar
    </BotonAccion>
  );
}

export function InvitarUsuarioBoton({ orgId, usuario }: { orgId: number; usuario: UsuarioFila }) {
  if (!usuario.activo || !usuario.email) return null;
  return (
    <BotonAccion action={invitarUsuarioPlataformaFormAction} ocultos={{ org_id: orgId, id: usuario.id }}>
      {usuario.estado_cuenta === "pendiente" ? "Enviar invitación" : "Reenviar acceso"}
    </BotonAccion>
  );
}

export function CrearUsuariosParaNucleosBoton({ orgId, sinUsuario }: { orgId: number; sinUsuario: number }) {
  return (
    <FormularioEnModal
      textoBoton={`Crear usuarios para los núcleos sin usuario (${sinUsuario})`}
      titulo="Crear usuarios para los núcleos"
      descripcion={
        <p>
          Se crea un usuario <b>pendiente de activación</b> (rol Socio, sin email ni contraseña) para cada núcleo que todavía no tiene uno, vinculado a su núcleo. Si ya existe un usuario con ese nombre, se vincula en vez de duplicarlo.
        </p>
      }
      action={crearUsuariosParaNucleosFormAction}
      ocultos={{ org_id: orgId }}
      textoConfirmar="Crear usuarios"
      claseBoton={CLASE_BOTON_AGREGAR}
    />
  );
}

// ---------------------------------------------------------------------------
// Comisiones
// ---------------------------------------------------------------------------

export function CargarComisionesLoteForm({ orgId }: { orgId: number }) {
  return (
    <FormularioEnModal
      textoBoton="Cargar comisiones"
      titulo="Asignar personas a comisiones"
      descripcion="Una línea por comisión: el nombre, dos puntos y las personas separadas por coma. Las personas se buscan por nombre entre los usuarios existentes (sin importar mayúsculas ni tildes), así que no se duplican."
      action={cargarComisionesEnLoteFormAction}
      ocultos={{ org_id: orgId }}
      textoConfirmar="Asignar"
      claseBoton={CLASE_BOTON_AGREGAR}
    >
      <div>
        <Label required>Comisiones y personas</Label>
        <textarea
          name="texto"
          required
          rows={8}
          placeholder={"Comisión de Obra: Gabriela Alvez, Jessica Vidart\nComisión de Compras: Soledad González, Daiana Urrutia"}
          className={`${inputClass} font-mono`}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="crear_comisiones" /> Crear las comisiones que falten
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="crear_personas" /> Crear las personas que falten (se crean sin núcleo, pendientes de activación)
      </label>
    </FormularioEnModal>
  );
}

// ---------------------------------------------------------------------------
// Limpieza de datos de prueba
// ---------------------------------------------------------------------------

export function LimpiezaForm({ orgId, vista }: { orgId: number; vista: VistaPreviaLimpieza }) {
  const [estado, formAction] = useActionState(ejecutarLimpiezaPruebaFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok && estado.aviso) show(estado.aviso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const hay = vista.socios.length + vista.usuarios.length > 0;
  if (!hay) return <p className="text-sm text-ink/60">No hay núcleos ni usuarios para limpiar.</p>;

  return (
    <form action={formAction} className="space-y-4 text-ink">
      <input type="hidden" name="org_id" value={orgId} />
      <FormError message={estado.error} />
      {estado.ok && estado.aviso && <p className="rounded-lg bg-[var(--color-verde-bg)] px-3 py-2 text-sm font-medium text-[var(--color-verde)]">{estado.aviso}</p>}

      <section>
        <h3 className="text-sm font-semibold mb-1">Núcleos / socios ({vista.socios.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-border">
                <th className="py-1.5 pr-2 w-8"></th>
                <th className="py-1.5 pr-3">N.º</th>
                <th className="py-1.5 pr-3">Nombre</th>
                <th className="py-1.5 pr-3">Integrantes</th>
                <th className="py-1.5">Clasificación</th>
              </tr>
            </thead>
            <tbody>
              {vista.socios.map((s) => (
                <tr key={s.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" name="socio_ids" value={s.id} defaultChecked={s.clasificacion === "prueba"} aria-label={`Limpiar ${s.nombre}`} />
                  </td>
                  <td className="py-1.5 pr-3">{s.numero_nucleo ?? "—"}</td>
                  <td className="py-1.5 pr-3">{s.nombre}</td>
                  <td className="py-1.5 pr-3">{s.integrantes}</td>
                  <td className="py-1.5">
                    <Badge color={s.clasificacion === "prueba" ? "amarillo" : "gray"}>{s.clasificacion === "prueba" ? "De prueba" : "Revisar"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-1">Usuarios ({vista.usuarios.length})</h3>
        <p className="text-xs text-ink/50 mb-1">Los administradores del sistema y de la plataforma no aparecen: nunca se limpian. Nada se borra: todo pasa a baja y se puede restaurar desde el respaldo.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-border">
                <th className="py-1.5 pr-2 w-8"></th>
                <th className="py-1.5 pr-3">Nombre</th>
                <th className="py-1.5 pr-3">Email</th>
                <th className="py-1.5 pr-3">Comisiones</th>
                <th className="py-1.5">Clasificación</th>
              </tr>
            </thead>
            <tbody>
              {vista.usuarios.map((u) => (
                <tr key={u.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" name="user_ids" value={u.id} defaultChecked={u.clasificacion === "prueba"} aria-label={`Limpiar ${u.nombre}`} />
                  </td>
                  <td className="py-1.5 pr-3">{u.nombre}</td>
                  <td className="py-1.5 pr-3 text-ink/60">{u.email ?? "—"}</td>
                  <td className="py-1.5 pr-3">{u.comisiones}</td>
                  <td className="py-1.5">
                    <Badge color={u.clasificacion === "prueba" ? "amarillo" : "gray"}>{u.clasificacion === "prueba" ? "De prueba" : "Revisar"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rounded-xl border border-border bg-surface-sunken/50 p-3 space-y-2">
        <p className="text-sm">
          Solo vienen tildados los que dicen claramente ser de prueba. Los marcados «Revisar» no se pueden asegurar: tildalos solo si estás seguro. Antes de tocar nada se guarda un
          <b> respaldo completo</b> que podés descargar y usar para restaurar.
        </p>
        <div>
          <Label required>Para confirmar, escribí LIMPIAR</Label>
          <input name="confirmacion" required autoComplete="off" className={inputClass} placeholder="LIMPIAR" />
        </div>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingLabel="Limpiando…">
            Limpiar lo tildado
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}


export function RestaurarRespaldoBoton({ orgId, respaldoId }: { orgId: number; respaldoId: number }) {
  return (
    <FormularioEnModal
      textoBoton="Restaurar"
      titulo="Restaurar respaldo"
      descripcion={
        <p>
          ¿Restaurar el respaldo n.º {respaldoId}? Los núcleos y usuarios que se dieron de baja en esa limpieza vuelven a como estaban (con sus comisiones). Si algún N.º de núcleo ya lo usa
          otra persona, no se restaura nada y se explica por qué.
        </p>
      }
      action={restaurarRespaldoLimpiezaFormAction}
      ocultos={{ org_id: orgId, id: respaldoId }}
      textoConfirmar="Sí, restaurar"
      mensajeExito="Respaldo restaurado."
      claseBoton={CLASE_BOTON_CHICO}
    />
  );
}

export function VaciarDatosForm({ orgId }: { orgId: number }) {
  const [estado, formAction] = useActionState(vaciarDatosPruebaFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok && estado.aviso) show(estado.aviso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="space-y-3 text-ink rounded-xl border border-border bg-surface-sunken/50 p-3">
      <input type="hidden" name="org_id" value={orgId} />
      <p className="text-sm">
        Borra <b>todas las finanzas</b> (movimientos, compromisos, cuentas, fondos), las <b>notificaciones</b> y todo lo cargado en las comisiones (tareas, reuniones, actividades, obra, guardias, licitaciones…).
        Se conservan usuarios, núcleos, comisiones con sus integrantes, la configuración y la auditoría. Antes de borrar se guarda un <b>respaldo completo</b> que se puede restaurar.
      </p>
      <FormError message={estado.error} />
      {estado.ok && estado.aviso && <p className="rounded-lg bg-[var(--color-verde-bg)] px-3 py-2 text-sm font-medium text-[var(--color-verde)]">{estado.aviso}</p>}
      <div>
        <Label required>Para confirmar, escribí VACIAR</Label>
        <input name="confirmacion" required autoComplete="off" className={inputClass} placeholder="VACIAR" />
      </div>
      <div className="flex justify-end">
        <SubmitButton variant="danger" pendingLabel="Vaciando…">Vaciar datos de prueba</SubmitButton>
      </div>
    </form>
  );
}

/** Cargar el email de un núcleo y mandarle la invitación para que elija su contraseña. */
export function InvitarNucleoBoton({ orgId, nucleo }: { orgId: number; nucleo: NucleoFila }) {
  return (
    <FormularioEnModal
      textoBoton="Enviar mail"
      titulo={`Invitar a ${nucleo.nombre}`}
      descripcion={<p>Cargá el email y se le manda un mail para que elija su contraseña y empiece a usar COOVA. El link vale 7 días; se puede reenviar.</p>}
      action={invitarNucleoFormAction}
      ocultos={{ org_id: orgId, socio_id: nucleo.socio_id }}
      textoConfirmar="Guardar y enviar mail"
      claseBoton={CLASE_BOTON_CHICO}
    >
      <div>
        <Label required>Email</Label>
        <input name="email" type="email" required defaultValue={nucleo.email ?? ""} className={inputClass} placeholder="nombre@gmail.com" />
      </div>
    </FormularioEnModal>
  );
}

/** Borra para siempre un núcleo ya dado de baja (y sus usuarios). Pide confirmación en un pop-up y escribir ELIMINAR. */
export function EliminarNucleoDefinitivoBoton({ orgId, nucleo }: { orgId: number; nucleo: NucleoBajaFila }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, formAction] = useActionState(eliminarNucleoDefinitivoFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAbierto(false);
      show(estado.aviso || "Núcleo eliminado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={`${CLASE_BOTON_CHICO} text-[var(--color-rojo)]`}>
        Eliminar definitivamente
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Eliminar definitivamente">
        <form action={formAction} className="space-y-3 text-ink">
          <input type="hidden" name="org_id" value={orgId} />
          <input type="hidden" name="nucleo_id" value={nucleo.nucleo_id} />
          <p className="text-sm">
            ¿Eliminar para siempre el núcleo N.º {nucleo.numero_nucleo ?? "—"} ({nucleo.nombre})?
            {nucleo.usuarios.length > 0 && <> También se borra su usuario ({nucleo.usuarios.join(", ")}).</>}
          </p>
          <p className="rounded-lg bg-[var(--color-rojo-bg)] px-3 py-2 text-sm font-medium text-[var(--color-rojo)]">
            No se puede deshacer: no queda en la papelera ni hay respaldo. Se borran también sus integrantes, cuotas, pagos, horas y todo lo que tenga cargado.
          </p>
          <FormError message={estado.error} />
          <div>
            <Label required>Para confirmar, escribí ELIMINAR</Label>
            <input name="confirmacion" required autoComplete="off" className={inputClass} placeholder="ELIMINAR" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAbierto(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken">
              Volver
            </button>
            <SubmitButton variant="danger" pendingLabel="Eliminando…">Eliminar definitivamente</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
