import dayjs from "dayjs";
import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles";
import { logoutAction } from "@/lib/actions/auth";
import type { MiCuentaData } from "@/lib/logic";
import { Avatar } from "./EntidadLink";
import { Badge, StatTile, EmptyState } from "./ui";
import { MiCuentaTrigger } from "./MiCuentaClient";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

const badgeSocio: Record<string, "verde" | "gray" | "rojo"> = { activo: "verde", inactivo: "gray", baja: "rojo" };
const textoSocio: Record<string, string> = { activo: "Activo", inactivo: "Inactivo", baja: "Baja" };

/**
 * "Mi cuenta" en la barra superior (pedido explícito, 17/09): reemplaza los
 * botones grandes de acceso rápido que vivían en la cabecera (ver
 * accesosRapidosFor/AccesosRapidos en Nav.tsx, ahora retirados de ahí) por
 * un único acceso compacto, a la misma altura que el buscador, disponible
 * para CUALQUIER rol — a diferencia de la tarjeta "Mi cuenta" del Inicio
 * (dashboard/page.tsx), que solo se arma para quien tiene fila en `socios`.
 * Acá el botón siempre existe; lo que cambia es si hay o no un socio
 * asociado, mismo criterio de fondo que ya usa el dashboard.
 *
 * Es un Server Component: arma todo el JSX de las 3 vistas (resumen, perfil,
 * estado de cuenta) con datos ya resueltos y se los pasa como `children`
 * (ReactNode) al wrapper "use client" que solo maneja abrir/cerrar y qué
 * vista mostrar — nunca cruza una función común al límite cliente/servidor,
 * solo la Server Action de logout (mismo patrón que TopBarClient.tsx).
 */
export function MiCuenta({ data, size = 32, variant = "desktop" }: { data: MiCuentaData; size?: number; variant?: "desktop" | "mobile" }) {
  const primerNombre = data.nombre.trim().split(" ")[0] || data.nombre;
  const estadoLabel = data.socio ? textoSocio[data.socio.estado] ?? data.socio.estado : data.activo ? "Activo" : "Inactivo";
  const estadoColor = data.socio ? badgeSocio[data.socio.estado] ?? "gray" : data.activo ? "verde" : "rojo";

  // Dos versiones del disparador (mismo dato, mismo modal): en escritorio
  // vive en la Top Bar clara junto al buscador; en celular vive en la franja
  // superior de color de marca (ver TopBar en Nav.tsx), así que necesita
  // texto claro en vez de oscuro. Nunca dos componentes de "Mi cuenta"
  // distintos — solo cambia el envoltorio visual del botón que lo abre.
  const trigger =
    variant === "mobile" ? (
      <span className="flex items-center gap-2">
        <span className="text-right leading-tight">
          <span className="block text-xs text-white">{primerNombre}</span>
          <span className="block text-[10px] text-white/50">{ROLE_LABELS[data.rol]}</span>
        </span>
        <Avatar url={data.avatarUrl} nombre={data.nombre} size={size} className="border-white/30" />
      </span>
    ) : (
      <span className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-surface-sunken transition-colors">
        <Avatar url={data.avatarUrl} nombre={data.nombre} size={size} />
        <span className="hidden lg:block text-left leading-tight">
          <span className="block text-xs font-semibold text-ink truncate max-w-[110px]">{primerNombre}</span>
        </span>
      </span>
    );

  const resumen = (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar url={data.avatarUrl} nombre={data.nombre} size={56} />
        <div className="min-w-0">
          <p className="font-bold text-ink truncate">{data.nombre}</p>
          <p className="text-xs text-ink-faint truncate">{data.email}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="block text-xs text-ink-faint">Rol</span>
          <span className="text-ink font-medium">{ROLE_LABELS[data.rol]}</span>
        </div>
        <div>
          <span className="block text-xs text-ink-faint">Estado</span>
          <Badge color={estadoColor}>{estadoLabel}</Badge>
        </div>
      </div>
      {data.comisiones.length > 0 && (
        <div>
          <span className="block text-xs text-ink-faint mb-1">Comisión/es</span>
          <div className="flex flex-wrap gap-1.5">
            {data.comisiones.map((c) => (
              <Badge key={c.id} color={c.coordinador ? "brand" : "gray"}>
                {c.nombre}
                {c.coordinador ? " · Coordinador/a" : ""}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {(data.socio?.telefono || data.socio?.emailContacto) && (
        <div>
          <span className="block text-xs text-ink-faint mb-1">Contacto</span>
          <p className="text-ink">{[data.socio?.telefono, data.socio?.emailContacto].filter(Boolean).join(" · ")}</p>
        </div>
      )}
    </div>
  );

  const perfil = (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar url={data.avatarUrl} nombre={data.nombre} size={56} />
        <div className="min-w-0">
          <p className="font-bold text-ink truncate">{data.nombre}</p>
          <p className="text-xs text-ink-faint truncate">Usuario: {data.email}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <StatTile label="Rol" value={ROLE_LABELS[data.rol]} />
        <StatTile label="Estado" value={estadoLabel} color={estadoColor === "rojo" ? "rojo" : estadoColor === "verde" ? "verde" : undefined} />
      </div>
      <div className="text-sm">
        <span className="block text-xs text-ink-faint">Miembro desde</span>
        <span className="text-ink">{dayjs(data.creadoEn).format("DD/MM/YYYY")}</span>
      </div>
      {(data.socio?.telefono || data.socio?.emailContacto) && (
        <div className="text-sm">
          <span className="block text-xs text-ink-faint mb-0.5">Contacto</span>
          <p className="text-ink">{[data.socio?.telefono, data.socio?.emailContacto].filter(Boolean).join(" · ")}</p>
        </div>
      )}
      <div>
        <span className="block text-xs text-ink-faint mb-1">Comisión/es</span>
        {data.comisiones.length === 0 ? (
          <p className="text-sm text-ink-faint">No integra ninguna comisión activa.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.comisiones.map((c) => (
              <Badge key={c.id} color={c.coordinador ? "brand" : "gray"}>
                {c.nombre}
                {c.coordinador ? " · Coordinador/a" : ""}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const estadoCuenta = !data.socio ? (
    <EmptyState>Esta cuenta no tiene un núcleo/socio asociado, así que no tiene una cuota propia en Finanzas.</EmptyState>
  ) : (
    <div className="space-y-4">
      {data.socio.saldo > 0 ? (
        <p className="text-sm text-ink">
          Debés <span className="font-bold">{money(data.socio.saldo)}</span>.
        </p>
      ) : data.socio.saldo < 0 ? (
        <p className="text-sm text-[var(--color-verde)]">Estás al día — tenés un saldo a favor de {money(-data.socio.saldo)}.</p>
      ) : (
        <p className="text-sm text-[var(--color-verde)]">Estás al día. No tenés pagos pendientes.</p>
      )}
      {(data.socio.cuotasPendientes > 0 || data.socio.cuotasVencidas > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Cuotas pendientes" value={String(data.socio.cuotasPendientes)} color={data.socio.cuotasPendientes > 0 ? "amarillo" : undefined} />
          <StatTile label="Cuotas vencidas" value={String(data.socio.cuotasVencidas)} color={data.socio.cuotasVencidas > 0 ? "rojo" : undefined} />
        </div>
      )}
      {data.socio.proximoVencimiento && (
        <p className="text-xs text-ink-faint">Próximo vencimiento: {dayjs(data.socio.proximoVencimiento).format("DD/MM/YYYY")}</p>
      )}
      {data.socio.convenio && (
        <p className="text-sm text-ink">
          Convenio de pago activo (<span className="font-medium">{data.socio.convenio.motivo}</span>, cuota {money(data.socio.convenio.montoCuota)}).
        </p>
      )}
      <div>
        <span className="block text-xs text-ink-faint mb-1.5">Movimientos recientes</span>
        {data.socio.movimientosRecientes.length === 0 ? (
          <p className="text-sm text-ink-faint">Todavía no hay movimientos registrados.</p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {data.socio.movimientosRecientes.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-ink truncate">{m.concepto}</p>
                  <p className="text-xs text-ink-faint">{dayjs(m.fecha).format("DD/MM/YYYY")}</p>
                </div>
                <span className={`font-semibold shrink-0 ${m.tipo === "pago" ? "text-[var(--color-verde)]" : "text-ink"}`}>
                  {m.tipo === "pago" ? "−" : "+"}
                  {money(Number(m.monto))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <Link href={`/socios/${data.socio.id}`} className="inline-block text-xs font-semibold text-[var(--color-secondary)] hover:underline">
        Ver mi ficha completa →
      </Link>
    </div>
  );

  return (
    <MiCuentaTrigger
      trigger={trigger}
      resumen={resumen}
      perfil={perfil}
      estadoCuenta={estadoCuenta}
      configuracionHref="/configuracion"
      logoutAction={logoutAction}
    />
  );
}
