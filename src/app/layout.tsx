import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UFAMA | Sistema de gestión",
  description: "Sistema operativo digital UFAMA - cooperativa de vivienda por ayuda mutua",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo-ufama.png",
    apple: "/logo-ufama.png",
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
