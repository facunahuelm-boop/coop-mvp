import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { Card } from "@/components/ui";
import { FicharBotones } from "@/components/obra/FicharBotones";
import { codigoQrValido } from "@/lib/qrObra";
import { hoyEnUruguay, textoDia } from "@/lib/horasObra";
import { nucleoDelUsuario } from "@/lib/libretaHoras";

/** Fase 3A — lo que ve el socio al escanear el QR de la obra con el celular. */
export default async function FicharPage({ params }: { params: Promise<{ codigo: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { codigo } = await params;
  const valido = codigoQrValido(user.organization_id, codigo);
  const nucleoId = await nucleoDelUsuario(user.id, user.nucleo_id);
  const hoy = hoyEnUruguay();
  const [nucleo, turnos, fichadas] = nucleoId
    ? await Promise.all([
        get<{ nombre: string }>(`SELECT nombre FROM nucleos_familiares WHERE id = ?`, [nucleoId]),
        all<{ hora_inicio: string; hora_fin: string }>(`SELECT hora_inicio, hora_fin FROM asignaciones_horas WHERE nucleo_id = ? AND fecha = ? AND estado = 'activa' ORDER BY hora_inicio`, [nucleoId, hoy]).catch(() => []),
        all<{ tipo: string; hora: string }>(`SELECT tipo, hora FROM fichadas_obra WHERE nucleo_id = ? AND fecha = ? ORDER BY id`, [nucleoId, hoy]).catch(() => []),
      ])
    : [undefined, [], []];
  const siguiente = fichadas[fichadas.length - 1]?.tipo === "llegada" ? "salida" : "llegada";

  return (
    <div className="mx-auto max-w-md space-y-4 text-[17px]">
      <h1 className="text-2xl font-bold text-ink">Asistencia en la obra</h1>
      <p className="text-ink-muted first-letter:uppercase">{textoDia(hoy)}</p>
      {!valido ? (
        <Card>
          <p className="text-ink">Este QR no es el de hoy. Pedile al coordinador que te muestre el QR del día.</p>
        </Card>
      ) : !nucleoId ? (
        <Card>
          <p className="text-ink">Tu usuario no está vinculado a un núcleo. Pedile a la administración que lo vincule.</p>
        </Card>
      ) : (
        <>
          <Card>
            <p className="text-ink">
              <b>{nucleo?.nombre}</b>
            </p>
            <p className="mt-1 text-ink-muted">
              {turnos.length ? `Tu turno de hoy: ${turnos.map((t) => `${t.hora_inicio} a ${t.hora_fin}`).join(" y ")}.` : "Hoy no tenías turno: el coordinador va a confirmar tus horas."}
            </p>
            {fichadas.length > 0 && (
              <ul className="mt-3 space-y-1 text-ink">
                {fichadas.map((f, i) => (
                  <li key={i}>
                    {f.tipo === "llegada" ? "Llegaste" : "Te fuiste"} a las <b>{f.hora}</b>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <FicharBotones codigo={codigo} siguiente={siguiente} />
        </>
      )}
    </div>
  );
}
