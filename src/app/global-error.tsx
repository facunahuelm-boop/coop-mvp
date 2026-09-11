"use client";

// Mismo criterio que error.tsx, pero para el caso (poco común) de que el
// error ocurra en el layout raíz mismo, donde error.tsx no alcanza a
// interceptarlo. Next.js exige que este archivo incluya su propio <html>/
// <body> porque reemplaza el layout raíz entero mientras se muestra.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "system-ui, sans-serif" }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Ocurrió un problema</h1>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
              El sistema no pudo cargar. Podés intentar de nuevo.
            </p>
            <button
              onClick={() => reset()}
              style={{ borderRadius: 12, background: "#123240", color: "#fff", padding: "10px 20px", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}
            >
              Reintentar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
