import { UsarLinkForm } from "@/components/AccesoFormularios";

export const metadata = { title: "Entrar | COOVA", robots: { index: false, follow: false } };
/** Fase 1E: destino del link por email. No entra solo: hay que tocar "Entrar" (así los lectores de correo no gastan el link). */
export default async function AccesoPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <UsarLinkForm token={String(token || "").slice(0, 200)} />;
}
