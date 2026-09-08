"use client";

import { useState } from "react";
import Link from "next/link";
import dayjs, { Dayjs } from "dayjs";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Calendario visual mensual, compartido entre /calendario (vista completa,
// con navegación de mes) y el Dashboard (versión compacta, mes actual).
// No trae datos propios: recibe los mismos eventos que ya arma cada página
// (reuniones, jornadas, hitos de obra, vencimientos) y solo se encarga de
// dibujarlos en una grilla con colores, algo más fácil de leer de un
// vistazo que una lista — pensado para alguien sin mucha práctica con
// calendarios digitales: tocás un día y te dice, en una frase, qué hay.

export type EventoCalendario = {
  id: string;
  fecha: string; // YYYY-MM-DD (o timestamp — se usan los primeros 10 caracteres)
  titulo: string;
  tipo: string;
  href: string;
};

const TIPO_COLOR_DOT: Record<string, string> = {
  reunion: "bg-[var(--color-brand-700)]",
  asamblea: "bg-[var(--color-brand-700)]",
  jornada: "bg-[var(--color-brand-700)]",
  obra: "bg-[var(--color-amarillo)]",
  finanzas: "bg-[var(--color-rojo)]",
  seguridad: "bg-[var(--color-amarillo)]",
};

const TIPO_LABEL: Record<string, string> = {
  reunion: "Reunión",
  asamblea: "Asamblea",
  jornada: "Jornada de trabajo",
  obra: "Obra",
  finanzas: "Vencimiento",
  seguridad: "Seguridad",
};

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

function isoDate(d: Dayjs) {
  return d.format("YYYY-MM-DD");
}

export function MonthCalendar({
  eventos,
  compact = false,
  verMasHref,
}: {
  eventos: EventoCalendario[];
  compact?: boolean;
  verMasHref?: string;
}) {
  const hoy = dayjs();
  const [mes, setMes] = useState(() => hoy.startOf("month"));
  const [seleccionado, setSeleccionado] = useState<string | null>(() => isoDate(hoy));

  const eventosPorDia = new Map<string, EventoCalendario[]>();
  for (const e of eventos) {
    const key = e.fecha.slice(0, 10);
    const arr = eventosPorDia.get(key) || [];
    arr.push(e);
    eventosPorDia.set(key, arr);
  }

  // day() da 0=domingo..6=sábado; acá la semana arranca el lunes.
  const offset = (mes.startOf("month").day() + 6) % 7;
  const diasEnMes = mes.daysInMonth();
  const celdas: (Dayjs | null)[] = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(mes.date(d));
  while (celdas.length % 7 !== 0) celdas.push(null);

  const eventosSeleccionado = seleccionado ? eventosPorDia.get(seleccionado) || [] : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setMes(mes.subtract(1, "month"))}
          aria-label="Mes anterior"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-surface-sunken text-ink-muted"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-bold text-ink capitalize">{mes.format("MMMM YYYY")}</p>
        <button
          type="button"
          onClick={() => setMes(mes.add(1, "month"))}
          aria-label="Mes siguiente"
          className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-surface-sunken text-ink-muted"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-ink-faint uppercase mb-1">
        {DIAS.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celdas.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = isoDate(d);
          const evs = eventosPorDia.get(key) || [];
          const esHoy = key === isoDate(hoy);
          const esSeleccionado = key === seleccionado;
          return (
            <button
              type="button"
              key={i}
              onClick={() => setSeleccionado(esSeleccionado ? null : key)}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                esSeleccionado
                  ? "bg-[var(--color-brand-800)] text-white"
                  : esHoy
                  ? "bg-brand-100 text-[var(--color-brand-900)] font-bold"
                  : "text-ink hover:bg-surface-sunken"
              }`}
            >
              <span>{d.date()}</span>
              {evs.length > 0 && (
                <span className="flex gap-0.5">
                  {evs.slice(0, 3).map((e, j) => (
                    <span key={j} className={`h-1.5 w-1.5 rounded-full ${esSeleccionado ? "bg-white" : TIPO_COLOR_DOT[e.tipo] || "bg-ink/30"}`} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 min-h-[2.5rem]">
        {seleccionado && eventosSeleccionado.length > 0 ? (
          <ul className="space-y-1.5">
            {eventosSeleccionado.map((e) => (
              <li key={e.id}>
                <Link href={e.href} className="flex items-center gap-2 text-sm text-ink hover:underline">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${TIPO_COLOR_DOT[e.tipo] || "bg-ink/30"}`} />
                  <span className="truncate">{e.titulo}</span>
                  <span className="text-xs text-ink-faint shrink-0">· {TIPO_LABEL[e.tipo] || e.tipo}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : seleccionado ? (
          <p className="text-sm text-ink-faint">Nada agendado para el {dayjs(seleccionado).format("D [de] MMMM")}.</p>
        ) : (
          <p className="text-sm text-ink-faint">Tocá un día para ver qué hay.</p>
        )}
      </div>

      {compact && verMasHref && (
        <div className="mt-3 text-right">
          <Link href={verMasHref} className="text-xs font-semibold text-[var(--color-brand-800)]">
            Ver calendario completo →
          </Link>
        </div>
      )}
    </div>
  );
}
