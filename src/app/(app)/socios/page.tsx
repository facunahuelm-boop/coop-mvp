import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit, canApprove } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, SectionTitle, EmptyState, Label, inputClass, Badge } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import {
  crearViviendaAction,
  actualizarViviendaEstadoAction,
  crearSocioAction,
  actualizarSocioEstadoAction,
  asignarViviendaSocioAction,
  agregarListaEsperaAction,
  actualizarListaEsperaEstadoAction,
  incorporarDesdeListaEsperaAction,
  moverListaEsperaAction,
} from "@/lib/actions/socios";
import { NucleoLink } from "@/components/EntidadLink";
import { BuscadorFilas } from "@/components/BuscadorFilas";

const ESTADOS_VIVIENDA = ["en_obra", "terminada", "ocupada"] as const;
const ESTADOS_SOCIO = ["activo", "inactivo", "baja"] as const;
const ESTADOS_LISTA_ESPERA = ["en_espera", "convocado", "incorporado", "retirado"] as const;

const badgeSocio: Record<string, "verde" | "amarillo" | "rojo"> = {
  activo: "verde",
  inactivo: "amarillo",
  baja: "rojo",
};

const badgeVivienda: Record<string, "amarillo" | "verde" | "brand"> = {
  en_obra: "amarillo",
  terminada: "brand",
  ocupada: "verde",
};

const badgeListaEspera: Record<string, "brand" | "amarillo" | "verde" | "gray"> = {
  en_espera: "brand",
  convocado: "amarillo",
  incorporado: "verde",
  retirado: "gray",
};

export default async function SociosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "socios")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "socios");
  const puedeAprobar = canApprove(user.rol, "socios");

  const [socios, viviendas, listaEspera, nucleos] = await Promise.all([
    all<any>(
      `SELECT s.*, v.numero as vivienda_numero, n.nombre as nucleo_nombre,
         (SELECT COUNT(*) FROM socio_integrantes si WHERE si.socio_id = s.id AND si.estado = 'activo') as cantidad_integrantes
       FROM socios s
       LEFT JOIN viviendas v ON v.id = s.vivienda_id
       LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
       ORDER BY s.nombre ASC`
    ).catch(async () =>
      // Igual criterio defensivo que /gastos: si la migración 0019 todavía no
      // se corrió en esta cooperativa, se degrada mostrando el padrón sin la
      // columna de integrantes en vez de romper toda la pantalla.
      (
        await all<any>(
          `SELECT s.*, v.numero as vivienda_numero, n.nombre as nucleo_nombre
           FROM socios s
           LEFT JOIN viviendas v ON v.id = s.vivienda_id
           LEFT JOIN nucleos_familiares n ON n.id = s.nucleo_id
           ORDER BY s.nombre ASC`
        )
      ).map((s) => ({ ...s, cantidad_integrantes: 0 }))
    ),
    all<any>(`SELECT * FROM viviendas ORDER BY numero ASC`),
    all<any>(`SELECT * FROM lista_espera WHERE estado != 'incorporado' AND estado != 'retirado' ORDER BY orden ASC`),
    all<any>(`SELECT id, nombre FROM nucleos_familiares ORDER BY nombre ASC`),
  ]);

  const viviendasLibres = viviendas.filter((v) => !socios.some((s) => s.vivienda_id === v.id));
  // Solo los aspirantes "en_espera" compiten por posición (ver
  // moverListaEsperaAction) — se usa para saber si mostrar la flecha de
  // subir/bajar en el extremo de la cola.
  const idsEnEspera = listaEspera.filter((l) => l.estado === "en_espera").map((l) => l.id);

  return (
    <div>
      <PageHeader title="Socios" subtitle="Padrón de socios, viviendas y lista de espera de aspirantes" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <Card className="lg:col-span-1">
          <div className="text-xs text-ink/50">Socios activos</div>
          <div className="text-2xl font-bold text-[var(--color-brand-900)] mt-1">
            {socios.filter((s) => s.estado === "activo").length}
          </div>
        </Card>
        <Card className="lg:col-span-1">
          <div className="text-xs text-ink/50">Viviendas</div>
          <div className="text-2xl font-bold text-[var(--color-brand-900)] mt-1">{viviendas.length}</div>
        </Card>
        <Card className="lg:col-span-1">
          <div className="text-xs text-ink/50">En lista de espera</div>
          <div className="text-2xl font-bold text-[var(--color-brand-900)] mt-1">
            {listaEspera.filter((l) => l.estado === "en_espera").length}
          </div>
        </Card>
      </div>

      {/* ---------- Socios ---------- */}
      <SectionTitle>Padrón de socios</SectionTitle>
      <Card className="mb-6">
        {socios.length === 0 ? (
          <EmptyState>Todavía no hay socios cargados.</EmptyState>
        ) : (
          // Fase 8 (paginación/búsqueda/filtros): buscador client-side sobre
          // las filas ya armadas por el servidor — ver BuscadorFilas.tsx
          // sobre por qué acá conviene esto y no paginación real.
          <BuscadorFilas
            placeholder="Buscar socio por nombre, vivienda, núcleo, email o teléfono..."
            sinResultadosTexto="No se encontró ningún socio con esa búsqueda."
            filas={socios.map((s) => ({
              clave: [s.nombre, s.vivienda_numero, s.nucleo_nombre, s.email, s.telefono].filter(Boolean).join(" "),
              nodo: (
                <tr key={s.id} className="border-b border-ink/5 last:border-0">
                  <td className="py-2 pr-3 text-ink/50">#{s.id}</td>
                  <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">
                    <Link href={`/socios/${s.id}`} className="hover:underline underline-offset-2">
                      {s.nombre}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-ink/60">
                    {Number(s.cantidad_integrantes) > 0 ? `+${s.cantidad_integrantes}` : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {puedeEditar ? (
                      <AutoSubmitSelect
                        action={asignarViviendaSocioAction}
                        hiddenFields={{ id: s.id }}
                        name="vivienda_id"
                        defaultValue={s.vivienda_id || ""}
                        options={[{ value: "", label: "Sin asignar" }, ...viviendas.map((v) => ({ value: v.id, label: v.numero }))]}
                        className="rounded-md border border-ink/10 bg-surface px-2 py-1 text-xs"
                      />
                    ) : (
                      s.vivienda_numero || <span className="text-ink/30">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-ink/60"><NucleoLink id={s.nucleo_id} nombre={s.nucleo_nombre} /></td>
                  <td className="py-2 pr-3 text-ink/60">
                    {s.email || s.telefono ? (
                      <>
                        {s.email && <div>{s.email}</div>}
                        {s.telefono && <div>{s.telefono}</div>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {puedeEditar ? (
                      <AutoSubmitSelect
                        action={actualizarSocioEstadoAction}
                        hiddenFields={{ id: s.id }}
                        name="estado"
                        defaultValue={s.estado}
                        options={ESTADOS_SOCIO.map((e) => ({ value: e, label: e }))}
                        className="rounded-md border border-ink/10 bg-surface px-2 py-1 text-xs"
                      />
                    ) : (
                      <Badge color={badgeSocio[s.estado] || "gray"}>{s.estado}</Badge>
                    )}
                  </td>
                </tr>
              ),
            }))}
          >
            {(filas) => (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                      <th className="py-2 pr-3">N.º núcleo</th>
                      <th className="py-2 pr-3">Titular</th>
                      <th className="py-2 pr-3">Integrantes</th>
                      <th className="py-2 pr-3">Vivienda</th>
                      <th className="py-2 pr-3">Núcleo familiar</th>
                      <th className="py-2 pr-3">Contacto</th>
                      <th className="py-2 pr-3">Estado</th>
                      {puedeEditar && <th className="py-2 pr-3"></th>}
                    </tr>
                  </thead>
                  <tbody>{filas}</tbody>
                </table>
              </div>
            )}
          </BuscadorFilas>
        )}

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Agregar socio</summary>
            <form action={crearSocioAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Nombre</Label><input name="nombre" required className={inputClass} /></div>
              <div><Label>Documento</Label><input name="documento" className={inputClass} /></div>
              <div><Label>Email</Label><input name="email" type="email" className={inputClass} /></div>
              <div><Label>Teléfono</Label><input name="telefono" className={inputClass} /></div>
              <div>
                <Label>Vivienda</Label>
                <select name="vivienda_id" className={inputClass} defaultValue="">
                  <option value="">Sin asignar</option>
                  {viviendas.map((v) => (
                    <option key={v.id} value={v.id}>{v.numero}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Núcleo familiar</Label>
                <select name="nucleo_id" className={inputClass} defaultValue="">
                  <option value="">Sin vincular</option>
                  {nucleos.map((n) => (
                    <option key={n.id} value={n.id}>{n.nombre}</option>
                  ))}
                </select>
              </div>
              <div><Label>Fecha de ingreso</Label><input name="fecha_ingreso" type="date" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Agregar socio</button>
              </div>
            </form>
          </details>
        )}
      </Card>

      {/* ---------- Viviendas ---------- */}
      <SectionTitle>Viviendas</SectionTitle>
      <Card className="mb-6">
        <div className="flex flex-wrap gap-2">
          {viviendas.map((v) => (
            <div key={v.id} className="rounded-xl bg-[var(--color-brand-50)] px-3 py-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-brand-900)]">{v.numero}</span>
              {puedeEditar ? (
                <AutoSubmitSelect
                  action={actualizarViviendaEstadoAction}
                  hiddenFields={{ id: v.id }}
                  name="estado"
                  defaultValue={v.estado}
                  options={ESTADOS_VIVIENDA.map((e) => ({ value: e, label: e }))}
                  className="rounded-md border border-ink/10 bg-surface px-1.5 py-0.5 text-xs"
                />
              ) : (
                <Badge color={badgeVivienda[v.estado] || "gray"}>{v.estado}</Badge>
              )}
            </div>
          ))}
          {viviendas.length === 0 && <EmptyState>Todavía no hay viviendas cargadas.</EmptyState>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Agregar vivienda</summary>
            <form action={crearViviendaAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Número / identificador</Label><input name="numero" required placeholder="Ej: Casa 12" className={inputClass} /></div>
              <div>
                <Label>Estado</Label>
                <select name="estado" className={inputClass} defaultValue="en_obra">
                  {ESTADOS_VIVIENDA.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Agregar vivienda</button>
              </div>
            </form>
          </details>
        )}
      </Card>

      {/* ---------- Lista de espera ---------- */}
      <SectionTitle>Lista de espera</SectionTitle>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Orden</th>
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3">Estado</th>
                {puedeAprobar && <th className="py-2 pr-3"></th>}
              </tr>
            </thead>
            <tbody>
              {listaEspera.map((l) => {
                const posicion = idsEnEspera.indexOf(l.id);
                const puedeReordenar = puedeEditar && posicion !== -1;
                return (
                <tr key={l.id} className="border-b border-ink/5 last:border-0">
                  <td className="py-2 pr-3 text-ink/60">
                    <div className="flex items-center gap-1">
                      <span>{l.orden}</span>
                      {puedeReordenar && (
                        <span className="flex flex-col -my-1">
                          <form action={moverListaEsperaAction}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="direccion" value="arriba" />
                            <button
                              type="submit"
                              disabled={posicion === 0}
                              className="block leading-none text-ink/40 hover:text-[var(--color-brand-800)] disabled:opacity-20 disabled:hover:text-ink/40"
                              title="Subir en la lista"
                            >
                              ▲
                            </button>
                          </form>
                          <form action={moverListaEsperaAction}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="direccion" value="abajo" />
                            <button
                              type="submit"
                              disabled={posicion === idsEnEspera.length - 1}
                              className="block leading-none text-ink/40 hover:text-[var(--color-brand-800)] disabled:opacity-20 disabled:hover:text-ink/40"
                              title="Bajar en la lista"
                            >
                              ▼
                            </button>
                          </form>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)]">{l.nombre}</td>
                  <td className="py-2 pr-3 text-ink/60">{l.contacto || "—"}</td>
                  <td className="py-2 pr-3">
                    {puedeEditar ? (
                      <AutoSubmitSelect
                        action={actualizarListaEsperaEstadoAction}
                        hiddenFields={{ id: l.id }}
                        name="estado"
                        defaultValue={l.estado}
                        options={ESTADOS_LISTA_ESPERA.map((e) => ({ value: e, label: e }))}
                        className="rounded-md border border-ink/10 bg-surface px-2 py-1 text-xs"
                      />
                    ) : (
                      <Badge color={badgeListaEspera[l.estado] || "gray"}>{l.estado}</Badge>
                    )}
                  </td>
                  {puedeAprobar && (
                    <td className="py-2 pr-3">
                      <form action={incorporarDesdeListaEsperaAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={l.id} />
                        <select name="vivienda_id" defaultValue="" className="rounded-md border border-ink/10 bg-surface px-1.5 py-1 text-xs">
                          <option value="">Sin vivienda</option>
                          {viviendasLibres.map((v) => (
                            <option key={v.id} value={v.id}>{v.numero}</option>
                          ))}
                        </select>
                        <button className="text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap">
                          Incorporar como socio
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
          {listaEspera.length === 0 && <EmptyState>No hay aspirantes en lista de espera.</EmptyState>}
        </div>

        {puedeEditar && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Agregar aspirante</summary>
            <form action={agregarListaEsperaAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Nombre</Label><input name="nombre" required className={inputClass} /></div>
              <div><Label>Documento</Label><input name="documento" className={inputClass} /></div>
              <div><Label>Contacto</Label><input name="contacto" placeholder="Teléfono o email" className={inputClass} /></div>
              <div className="sm:col-span-2"><Label>Notas</Label><input name="notas" className={inputClass} /></div>
              <div className="sm:col-span-2">
                <button className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2 text-sm font-semibold">Agregar a la lista</button>
              </div>
            </form>
          </details>
        )}
      </Card>
    </div>
  );
}
