import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { generarPdfConvocatoria, generarPdfPadron, generarPdfActa } from "@/lib/asambleasPdf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Fase 2D — PDFs de la asamblea: ?doc=convocatoria | padron | acta. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canRead(user.rol, "comisiones")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const { id } = await params;
  const doc = new URL(req.url).searchParams.get("doc") || "convocatoria";
  // El padrón tiene la causa de cada inhabilitado (por ejemplo, deudas): sólo quien conduce.
  if (doc === "padron" && !canEdit(user.rol, "finanzas") && user.rol !== "consejo_directivo" && user.rol !== "fiscal") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    const pdf =
      doc === "acta" ? await generarPdfActa(Number(id), user.organizacion) : doc === "padron" ? await generarPdfPadron(Number(id), user.organizacion) : await generarPdfConvocatoria(Number(id), user.organizacion);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="asamblea-${id}-${doc}.pdf"`, "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
