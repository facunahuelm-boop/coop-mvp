import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { obtenerReglamento } from "@/lib/reglamento";
import { ROLES_CON_2FA } from "@/lib/totp";
import { getCurrentUser } from "@/lib/auth";
import { alertasParaTopBar, datosMiCuenta } from "@/lib/logic";
import { Sidebar, TopBar, TopBarDesktop, BottomNav } from "@/components/Nav";
import { CommandPalette } from "@/components/CommandPalette";
import { ToastProvider, CommandPaletteProvider, PreservarDatosAnteErrores, ValidacionEnFormularios } from "@/components/ui-client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Fase 1E: si la cooperativa exige la verificación en dos pasos para los
  // roles que manejan dinero o datos sensibles, quien todavía no la activó
  // sólo puede usar la pantalla "Mi seguridad" hasta activarla.
  if ((ROLES_CON_2FA as readonly string[]).includes(user.rol) && !user.totp_activo) {
    const ruta = (await headers()).get("x-coova-path") || "";
    if (!ruta.startsWith("/mi-seguridad") && (await obtenerReglamento()).seguridad.exigir2fa) redirect("/mi-seguridad?obligatorio=1");
  }

  // Rediseño "Color secundario + Top Bar" (puntos 11-12): sólo LEE la tabla
  // alertas, no la recalcula (ver la nota grande en lib/logic.ts) — así la
  // campana puede vivir acá, en el layout de TODA la app, sin que cada
  // navegación pague el costo de recalcularAlertas().
  const alertas = await alertasParaTopBar();
  // Rediseño "Mi cuenta" (17/09): mismo criterio que alertas — se resuelve
  // una vez acá, en el layout de toda la app, para que el acceso "Mi cuenta"
  // esté disponible en cualquier pantalla sin que cada página arme su propia
  // consulta (ver MiCuenta.tsx / datosMiCuenta en logic.ts).
  const datosCuenta = await datosMiCuenta(user.id);
  const miCuenta = datosCuenta ? { ...datosCuenta, letraGrande: user.letra_grande } : datosCuenta;

  return (
    // Fase 3 (sistema global de errores): ToastProvider ya existía construido
    // pero sin montar en ninguna pantalla — acá queda disponible una sola vez
    // para toda la app (useToast() desde cualquier Client Component), en vez
    // de que cada formulario migrado tenga que armar su propio mecanismo de
    // aviso de guardado/error.
    <ToastProvider>
      <CommandPaletteProvider>
        <div className={`min-h-full flex-1 bg-[var(--color-page-bg)]${user.letra_grande ? " letra-grande-raiz" : ""}`}>
          {/* Fase 1A (accesibilidad): "Letra grande" agranda la raíz del
              documento, así todo lo medido en rem crece parejo. */}
          {user.letra_grande && <style>{"html{font-size:112.5%}"}</style>}
          <Sidebar user={user} esSocio={!!datosCuenta?.socio} />
          <div className="md:pl-64 flex flex-col min-h-full">
            <TopBar user={user} miCuenta={miCuenta} />
            <TopBarDesktop user={user} alertas={alertas} miCuenta={miCuenta} />
            <main className="flex-1 px-4 sm:px-6 py-5 pb-24 md:pb-8 max-w-5xl w-full mx-auto">{children}</main>
          </div>
          <BottomNav user={user} esSocio={!!datosCuenta?.socio} />
          {/* Fase 11 del Plan Maestro: atajo Ctrl+K disponible en toda la app,
              no solo en /buscar. Se monta una vez acá para no repetirlo por
              página. */}
          <CommandPalette />
          {/* Testing funcional (04/10): que un error de validación no borre lo
              que la persona ya escribió — ver PreservarDatosAnteErrores. */}
          <PreservarDatosAnteErrores />
          {/* Revisión 04/10 del pedido de validaciones: mensajes debajo del
              campo antes de enviar, en vez del globito del navegador. */}
          <ValidacionEnFormularios />
        </div>
      </CommandPaletteProvider>
    </ToastProvider>
  );
}
