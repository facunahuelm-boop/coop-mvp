"use server";

import { requireUser } from "@/lib/auth";
import { askIA, type IaAnswer } from "@/lib/ia";

export async function preguntarIaAction(pregunta: string): Promise<IaAnswer> {
  const user = await requireUser();
  const texto = typeof pregunta === "string" ? pregunta.trim().slice(0, 500) : "";
  if (!texto) {
    return { answer: "Escribí una pregunta para empezar.", engine: "local", sources: [] };
  }
  return askIA(texto, user);
}
