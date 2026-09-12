import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar, TopBar, BottomNav } from "@/components/Nav";
import { CommandPalette } from "@/components/CommandPalette";
import { ToastProvider } from "@/components/ui-client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    // Fase 3 (sistema global de errores): ToastProvider ya existía construido
    // pero sin montar en ninguna pantalla — acá queda disponible una sola vez
    // para toda la app (useToast() desde cualquier Client Component), en vez
    // de que cada formulario migrado tenga que armar su propio mecanismo de
    // aviso de guardado/error.
    <ToastProvider>
      <div className="min-h-full flex-1 bg-[var(--color-page-bg)]">
        <Sidebar user={user} />
        <div className="md:pl-64 flex flex-col min-h-full">
          <TopBar user={user} />
          <main className="flex-1 px-4 sm:px-6 py-5 pb-24 md:pb-8 max-w-5xl w-full mx-auto">{children}</main>
        </div>
        <BottomNav user={user} />
        {/* Fase 11 del Plan Maestro: atajo Ctrl+K disponible en toda la app,
            no solo en /buscar. Se monta una vez acá para no repetirlo por
            página. */}
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}
