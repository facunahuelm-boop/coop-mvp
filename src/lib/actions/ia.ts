"use server";

import { requireUser } from "@/lib/auth";
import { askIA, type IaAnswer } from "@/lib/ia";

export async function preguntarIaAction(pregunta: string): Promise<IaAnswer> {
  const user = await requireUser();
  if (!pregunta || pregunta.trim().length === 0) {
    return { answer: "Escribí una pregunta para empezar.", engine: "local", sources: [] };
  }
  return askIA(pregunta.trim(), user);
}
