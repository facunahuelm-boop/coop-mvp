"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { preguntarIaAction } from "@/lib/actions/ia";
import type { IaAnswer } from "@/lib/ia";

type Msg = { role: "user" | "ia"; text: string; sources?: IaAnswer["sources"]; engine?: string };

export default function ChatIA({ preguntasSugeridas, conectada }: { preguntasSugeridas: string[]; conectada: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "ia", text: "Hola, soy la IA de la cooperativa. Puedo leer los datos ya cargados en el sistema y responder preguntas sobre obra, trabajo, compras, seguridad y finanzas. No apruebo compras, pagos ni decisiones: solo informo y sugiero." },
  ]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function ask(pregunta: string) {
    if (!pregunta.trim()) return;
    setMessages((m) => [...m, { role: "user", text: pregunta }]);
    setInput("");
    startTransition(async () => {
      const res = await preguntarIaAction(pregunta);
      setMessages((m) => [...m, { role: "ia", text: res.answer, sources: res.sources, engine: res.engine }]);
    });
  }

  return (
    <div className="flex flex-col h-[70vh] sm:h-[75vh] bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      {!conectada && (
        <div className="bg-[#e7eff1] text-[#1f4e5f] text-xs px-4 py-2">
          Funcionando con el motor de reglas locales (sin API key de IA conectada todavía). Las respuestas usan datos reales del sistema.
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-[#1f4e5f] text-white" : "bg-[#f2f5f6] text-[#1c1f21]"}`}>
              {m.text}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-black/10 text-[11px] opacity-70 space-y-0.5">
                  {m.sources.map((s, j) => <div key={j}>📎 {s.label}{s.detail ? ` — ${s.detail}` : ""}</div>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && <div className="text-xs text-black/40">Pensando…</div>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-black/5 px-3 py-2 flex gap-1.5 overflow-x-auto">
        {preguntasSugeridas.map((p) => (
          <button key={p} onClick={() => ask(p)} className="whitespace-nowrap text-xs rounded-full bg-[#e7eff1] text-[#1f4e5f] px-3 py-1.5 hover:bg-[#d8e6e9]">{p}</button>
        ))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="border-t border-black/5 p-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribí tu pregunta…"
          className="flex-1 rounded-xl border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e5f]/30"
        />
        <button type="submit" disabled={pending} className="rounded-xl bg-[#1f4e5f] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">Enviar</button>
      </form>
    </div>
  );
}
