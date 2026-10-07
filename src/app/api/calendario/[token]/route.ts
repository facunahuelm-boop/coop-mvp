import { NextRequest } from "next/server";
import { all, get, rootGet } from "@/lib/db";
import { setOrgContext } from "@/lib/tenant";
import { canRead, type Role } from "@/lib/roles";
import { hoyEnUruguay, sumarDias } from "@/lib/horasObra";

export const dynamic = "force-dynamic";

/**
 * Fase 2F — calendario personal en formato ICS (Google Calendar, iPhone).
 * El link lleva una clave personal (users.ics_token) que la persona puede
 * cambiar en /preferencias; no necesita sesión. Sólo trae lo que esa
 * persona ve en COOVA (mismos permisos que /calendario).
 */
type Ev = { uid: string; titulo: string; fecha: string; hora?: string | null; lugar?: string | null; detalle?: string | null };

function escapar(t: string): string {
  return t.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
/** Las líneas de un ICS no deben pasar de 75 caracteres. */
function plegar(linea: string): string {
  const partes: string[] = [];
  let resto = linea;
  while (resto.length > 74) {
    partes.push(resto.slice(0, 74));
    resto = " " + resto.slice(74);
  }
  partes.push(resto);
  return partes.join("\r\n");
}
function fechaHora(e: Ev): { inicio: string; fin: string } {
  const dia = e.fecha.slice(0, 10).replace(/-/g, "");
  const hora = e.hora ?? (e.fecha.length > 10 ? e.fecha.slice(11, 16) : null);
  if (hora && /^\d{2}:\d{2}$/.test(hora) && hora !== "00:00") {
    const [h, m] = hora.split(":").map(Number);
    const fin = `${String(Math.min(h + 2, 23)).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    return { inicio: `DTSTART;TZID=America/Montevideo:${dia}T${hora.replace(":", "")}00`, fin: `DTEND;TZID=America/Montevideo:${dia}T${fin}` };
  }
  const siguiente = sumarDias(e.fecha.slice(0, 10), 1).replace(/-/g, "");
  return { inicio: `DTSTART;VALUE=DATE:${dia}`, fin: `DTEND;VALUE=DATE:${siguiente}` };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  const m = /^(\d+)\.([A-Za-z0-9_-]{20,})$/.exec(token);
  if (!m) return new Response("No encontrado", { status: 404 });
  const orgId = Number(m[1]);
  const org = await rootGet<{ id: number; nombre: string }>(`SELECT id, nombre FROM organizations WHERE id = ? AND activo = 1`, [orgId]);
  if (!org) return new Response("No encontrado", { status: 404 });
  setOrgContext(orgId);
  const user = await get<{ id: number; rol: Role }>(`SELECT id, rol FROM users WHERE ics_token = ? AND activo = 1`, [token]).catch(() => undefined);
  if (!user) return new Response("No encontrado", { status: 404 });

  const hoy = hoyEnUruguay();
  const desde = sumarDias(hoy, -30);
  const hasta = sumarDias(hoy, 365);
  const verComisiones = canRead(user.rol, "comisiones");
  const verTrabajo = canRead(user.rol, "trabajo");
  const [reuniones, jornadas, tramites, notas] = await Promise.all([
    all<{ id: number; titulo: string; fecha: string; tipo: string; lugar: string | null }>(
      `SELECT id, titulo, fecha, tipo, lugar FROM reuniones WHERE estado = 'planificada' AND fecha >= ? AND fecha <= ? ${verComisiones ? "" : "AND tipo = 'asamblea'"} ORDER BY fecha LIMIT 200`,
      [desde, hasta]
    ).catch(() => []),
    verTrabajo
      ? all<{ id: number; fecha: string; descripcion: string | null }>(`SELECT id, fecha, descripcion FROM jornadas_trabajo WHERE estado = 'planificada' AND fecha >= ? AND fecha <= ? ORDER BY fecha LIMIT 200`, [desde, hasta]).catch(() => [])
      : Promise.resolve([]),
    all<{ id: number; titulo: string; fecha_estimada: string }>(
      `SELECT id, titulo, fecha_estimada FROM tramites_hitos WHERE activo = 1 AND estado IN ('pendiente', 'en_curso', 'trabado') AND fecha_estimada >= ? AND fecha_estimada <= ? ${user.rol === "socio" ? "AND visible_socios = 1" : ""}`,
      [desde, hasta]
    ).catch(() => []),
    all<{ id: number; titulo: string; fecha: string; hora: string | null; todo_el_dia: number | null; ubicacion: string | null; descripcion: string | null }>(
      `SELECT id, titulo, fecha, hora, todo_el_dia, ubicacion, descripcion FROM notas_calendario WHERE fecha >= ? AND fecha <= ? ORDER BY fecha LIMIT 300`,
      [desde, hasta]
    ).catch(() => []),
  ]);

  const eventos: Ev[] = [
    ...reuniones.map((r) => ({ uid: `reunion-${r.id}`, titulo: r.titulo, fecha: r.fecha, lugar: r.lugar })),
    ...jornadas.map((j) => ({ uid: `jornada-${j.id}`, titulo: "Jornada de trabajo", fecha: j.fecha, detalle: j.descripcion })),
    ...tramites.map((h) => ({ uid: `tramite-${h.id}`, titulo: `Trámite (fecha prevista): ${h.titulo}`, fecha: h.fecha_estimada })),
    ...notas.map((n) => ({ uid: `actividad-${n.id}`, titulo: n.titulo, fecha: n.fecha, hora: n.todo_el_dia ? null : n.hora, lugar: n.ubicacion, detalle: n.descripcion })),
  ];

  const ahora = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//COOVA//Calendario//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapar(org.nombre)}`,
    "X-WR-TIMEZONE:America/Montevideo",
  ];
  for (const e of eventos) {
    const { inicio, fin } = fechaHora(e);
    lineas.push("BEGIN:VEVENT", `UID:${e.uid}-org${orgId}@coova`, `DTSTAMP:${ahora}`, inicio, fin, `SUMMARY:${escapar(e.titulo)}`);
    if (e.lugar) lineas.push(`LOCATION:${escapar(e.lugar)}`);
    if (e.detalle) lineas.push(`DESCRIPTION:${escapar(e.detalle)}`);
    lineas.push("END:VEVENT");
  }
  lineas.push("END:VCALENDAR");
  return new Response(lineas.map(plegar).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="coova.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
