import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card, PageHeader, Badge } from "@/components/ui";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { estadoAlta } from "@/lib/alta";
import { PLANTILLAS_ALTA, MODALIDAD_LABEL, type Modalidad } from "@/lib/plantillasAlta";
import { ETAPA_LABEL, type EtapaCooperativa } from "@/lib/comisionesFunciones";
import { DatosAltaForm, ComisionesSugeridasBoton, InvitarUsuarioForm, CompletarAltaBoton } from "@/components/alta/AltaFormularios";

/**
 * Fase 2H — asistente de alta de cooperativa (plan, 12): seis pasos con
 * su estado, para quedar operativa en menos de un día.
 */
function Paso({ n, titulo, hecho, detalle, children }: { n: number; titulo: string; hecho: boolean; detalle?: string; children?: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">
          <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand-100)] text-sm text-[var(--color-brand-800)]">{n}</span>
          {titulo}
        </h2>
        <Badge color={hecho ? "verde" : "gray"}>{hecho ? "Hecho" : "Falta"}</Badge>
      </div>
      {detalle && <p className="mb-3 text-[15px] text-ink-muted">{detalle}</p>}
      {children}
    </Card>
  );
}

const enlace = "inline-flex items-center justify-center rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken";

export default async function AltaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.rol !== "admin") redirect("/dashboard");
  const e = await estadoAlta(user.organization_id);
  const plantillaActual =
    e.etapa === "habitada" ? "habitada" : e.modalidad === "ahorro_previo" ? "ahorro_previo" : e.etapa === "pre_obra" ? "ayuda_mutua_pre_obra" : "ayuda_mutua_obra";
  const listo = e.hechos === 5;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Tu cooperativa en COOVA"
        subtitle={`${e.hechos} de 5 pasos hechos · ${MODALIDAD_LABEL[e.modalidad as Modalidad] ?? e.modalidad} · ${ETAPA_LABEL[e.etapa as EtapaCooperativa] ?? e.etapa}`}
        action={e.completada ? <Badge color="verde">Alta terminada</Badge> : undefined}
      />
      <div className="mb-5 h-3 overflow-hidden rounded-full bg-ink/5">
        <div className="h-full rounded-full bg-[var(--color-verde)]" style={{ width: `${(e.hechos / 5) * 100}%` }} />
      </div>

      <Paso n={1} titulo="Datos, modalidad y etapa" hecho={e.pasos.datos}>
        <DatosAltaForm nombre={e.nombre} plantillaActual={plantillaActual} plantillas={PLANTILLAS_ALTA.map(({ clave, nombre, descripcion }) => ({ clave, nombre, descripcion }))} />
      </Paso>

      <Paso n={2} titulo="Reglamento" hecho={e.pasos.reglamento} detalle="Cuotas, atrasos, horas y asambleas. Ya vienen valores sugeridos; lo automático queda apagado hasta que lo prendas.">
        <Link href="/reglamento" className={enlace}>
          Revisar el reglamento
        </Link>
      </Paso>

      <Paso
        n={3}
        titulo="Socios y núcleos"
        hecho={e.pasos.socios > 0}
        detalle={e.pasos.socios > 0 ? `Hay ${e.pasos.socios} socios cargados.` : "Bajá la planilla, completala con los socios y sus núcleos, y subila. Antes de guardar vas a ver una vista previa con los errores explicados."}
      >
        <div className="flex flex-wrap gap-2">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- es una descarga, no una página */}
          <a href="/api/importar/plantilla/socios?formato=xlsx" className={enlace}>
            Bajar la planilla (Excel)
          </a>
          <Link href="/importar" className={enlace}>
            Subir la planilla
          </Link>
          <Link href="/socios" className={enlace}>
            Cargar a mano
          </Link>
        </div>
      </Paso>

      <Paso n={4} titulo="Comisiones" hecho={e.pasos.comisiones > 0} detalle={e.pasos.comisiones > 0 ? `Hay ${e.pasos.comisiones} comisiones.` : "Las comisiones sugeridas para la etapa de la cooperativa."}>
        <div className="flex flex-wrap gap-2">
          <ComisionesSugeridasBoton />
          <Link href="/comisiones" className={enlace}>
            Ver comisiones
          </Link>
        </div>
      </Paso>

      <Paso
        n={5}
        titulo="Invitar a las personas"
        hecho={e.pasos.usuarios > 1}
        detalle="Tesorería, Consejo, Fiscal y las comisiones. A cada persona le llega un email para elegir su contraseña."
      >
        <InvitarUsuarioForm roles={ROLES.map((r) => ({ valor: r, nombre: ROLE_LABELS[r] }))} />
      </Paso>

      <Paso n={6} titulo="¡Lista!" hecho={e.completada}>
        {e.completada ? <p className="text-[15px] text-ink">El alta está terminada. Podés volver a esta pantalla cuando quieras.</p> : <CompletarAltaBoton listo={listo} />}
      </Paso>
    </div>
  );
}
