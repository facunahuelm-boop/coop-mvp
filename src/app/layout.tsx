import type { Metadata, Viewport } from "next";
import dayjs from "dayjs";
import "dayjs/locale/es";
import "./globals.css";

// Testing funcional (04/10): dayjs sólo se ponía en español dentro de 3
// acciones del servidor (reportes, informe fiscal, libros) — el resto del
// sistema quedaba en inglés según qué se hubiera cargado antes ("October
// 2026", "4 de October" en el Calendario). Acá se fija una vez para todo el
// lado servidor; ui-client.tsx hace lo mismo para el navegador. Ojo: el
// español cambia el primer día de la semana a lunes, pero el código usa
// `.day()` (que no depende del idioma) y no `startOf("week")`, así que la
// grilla del calendario no se corre.
dayjs.locale("es");

export const metadata: Metadata = {
  title: "COOVA | Sistema de gestión",
  description: "COOVA - plataforma de gestión digital para cooperativas de vivienda por ayuda mutua",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo-coova.png",
    apple: "/logo-coova.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "var(--color-brand-800)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
