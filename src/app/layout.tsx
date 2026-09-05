import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  themeColor: "#1f4e5f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
