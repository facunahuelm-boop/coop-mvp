import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import ChatIA from "@/components/ChatIA";
import { PREGUNTAS_SUGERIDAS } from "@/lib/ia";

export default async function IaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <PageHeader title="Asistente IA de la cooperativa" subtitle="Responde en base a los datos ya cargados en el sistema, citando la fuente." />
      <ChatIA preguntasSugeridas={PREGUNTAS_SUGERIDAS} conectada={!!process.env.ANTHROPIC_API_KEY} />
    </div>
  );
}
