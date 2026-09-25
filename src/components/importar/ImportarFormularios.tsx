"use client";

// Fase 6, Sub-fase 6.1 ("Migración de datos Excel/CSV"): wizard de 2 pasos
// (previsualizar → confirmar), compartido entre Padrón de socios y
// Movimientos financieros — la única diferencia entre ambos es qué acciones
// de servidor usa y qué columnas muestra en la vista previa (ver `columnas`),
// así que se armó un solo componente genérico en vez de duplicar el mismo
// flujo dos veces. Mismo patrón de llamar una Server Action directamente
// (sin <form>, con useTransition) que ya usa ChatIA.tsx — acá hace falta
// porque el resultado es una estructura rica (filas válidas/inválidas), no
// un simple ok/error como el resto de los formularios del sistema.

import { useState, useTransition, useRef } from "react";
import { useActionState, useEffect } from "react";
import { Card, Badge, Table, Th, Td, Button } from "@/components/ui";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import {
  previsualizarImportacionSocios,
  confirmarImportacionSocios,
  previsualizarImportacionMovimientos,
  confirmarImportacionMovimientos,
  deshacerImportacionFormAction,
} from "@/lib/actions/importaciones";
import { ESTADO_INICIAL } from "@/lib/actionState";

type FilaConError = { fila: number; error: string; valores: Record<string, string> };
type PreviewResultado<T> = {
  nombreArchivo: string;
  totalFilas: number;
  validas: { fila: number; datos: T }[];
  invalidas: FilaConError[];
};
type ConfirmarResultado = { importacionId: number; insertadas: number; fallidas: number };

type Columna = { clave: string; label: string };

type Paso = "elegir" | "previsualizando" | "preview" | "confirmando" | "listo";

/**
 * No se exporta: recibe las Server Actions ya importadas directamente por
 * cada wrapper de abajo (ImportarPadronSociosPanel / ImportarMovimientosPanel)
 * dentro de este mismo archivo "use client" — nunca se reciben como prop
 * desde un Server Component padre, mismo criterio del resto del sistema de
 * importar la Server Action en el propio archivo cliente que la usa.
 */
function ImportadorArchivoBase<T extends Record<string, unknown>>({
  tipoPlantilla,
  columnas,
  accionPreview,
  accionConfirmar,
}: {
  tipoPlantilla: "socios" | "movimientos";
  columnas: Columna[];
  accionPreview: (formData: FormData) => Promise<PreviewResultado<T>>;
  accionConfirmar: (nombreArchivo: string, filas: { fila: number; datos: T }[]) => Promise<ConfirmarResultado>;
}) {
  const [paso, setPaso] = useState<Paso>("elegir");
  const [preview, setPreview] = useState<PreviewResultado<T> | null>(null);
  const [resultado, setResultado] = useState<ConfirmarResultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function analizarArchivo() {
    const file = inputRef.current?.files?.[0];
    if (!file) { setError("Elegí un archivo primero."); return; }
    setError(null);
    setPaso("previsualizando");
    const formData = new FormData();
    formData.set("archivo", file);
    startTransition(async () => {
      try {
        const res = await accionPreview(formData);
        setPreview(res);
        setPaso("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
        setPaso("elegir");
      }
    });
  }

  function confirmar() {
    if (!preview) return;
    setPaso("confirmando");
    startTransition(async () => {
      try {
        const res = await accionConfirmar(preview.nombreArchivo, preview.validas);
        setResultado(res);
        setPaso("listo");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo importar.");
        setPaso("preview");
      }
    });
  }

  function reiniciar() {
    setPaso("elegir");
    setPreview(null);
    setResultado(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-ink">Subir archivo</p>
        <a href={`/api/importar/plantilla/${tipoPlantilla}`} className="text-xs underline text-[var(--color-brand-800)]">
          Descargar plantilla (.csv)
        </a>
      </div>

      {(paso === "elegir" || paso === "previsualizando") && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,.xls"
            className="text-sm flex-1"
            disabled={paso === "previsualizando"}
          />
          <Button onClick={analizarArchivo} disabled={paso === "previsualizando"}>
            {paso === "previsualizando" ? "Analizando…" : "Analizar archivo"}
          </Button>
        </div>
      )}

      <FormError message={error} />

      {paso === "preview" && preview && (
        <div className="mt-3">
          <p className="text-sm text-ink/70 mb-2">
            <strong>{preview.nombreArchivo}</strong> — {preview.totalFilas} fila{preview.totalFilas === 1 ? "" : "s"} leída{preview.totalFilas === 1 ? "" : "s"}:{" "}
            <Badge color="verde">{preview.validas.length} lista{preview.validas.length === 1 ? "" : "s"} para importar</Badge>{" "}
            {preview.invalidas.length > 0 && <Badge color="rojo">{preview.invalidas.length} con error</Badge>}
          </p>

          {preview.validas.length > 0 && (
            <div className="overflow-x-auto mb-3">
              <Table>
                <thead>
                  <tr>
                    <Th>Fila</Th>
                    {columnas.map((c) => <Th key={c.clave}>{c.label}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.validas.slice(0, 20).map(({ fila, datos }) => (
                    <tr key={fila}>
                      <Td>{fila}</Td>
                      {columnas.map((c) => <Td key={c.clave}>{String((datos as Record<string, unknown>)[c.clave] ?? "")}</Td>)}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {preview.validas.length > 20 && (
                <p className="text-xs text-ink/40 mt-1">Mostrando las primeras 20 de {preview.validas.length} filas — todas se van a importar igual.</p>
              )}
            </div>
          )}

          {preview.invalidas.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-[var(--color-rojo)] mb-1">Filas con error (no se van a importar):</p>
              <ul className="text-xs text-ink/60 space-y-0.5 max-h-40 overflow-y-auto">
                {preview.invalidas.slice(0, 30).map((f) => (
                  <li key={f.fila}>Fila {f.fila}: {f.error}</li>
                ))}
              </ul>
              {preview.invalidas.length > 30 && <p className="text-xs text-ink/40 mt-1">Y {preview.invalidas.length - 30} más.</p>}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={confirmar} disabled={preview.validas.length === 0}>
              Confirmar importación ({preview.validas.length})
            </Button>
            <Button variant="ghost" onClick={reiniciar}>Cancelar</Button>
          </div>
        </div>
      )}

      {paso === "confirmando" && <p className="text-sm text-ink/60 mt-3">Importando…</p>}

      {paso === "listo" && resultado && (
        <div className="mt-3">
          <p className="text-sm text-ink">
            Importación completa: <strong>{resultado.insertadas}</strong> fila{resultado.insertadas === 1 ? "" : "s"} importada{resultado.insertadas === 1 ? "" : "s"}
            {resultado.fallidas > 0 && <> — {resultado.fallidas} fallaron al guardar</>}.
          </p>
          <Button variant="secondary" className="mt-2" onClick={reiniciar}>Importar otro archivo</Button>
        </div>
      )}
    </Card>
  );
}

const COLUMNAS_SOCIOS: Columna[] = [
  { clave: "nombre", label: "Nombre" },
  { clave: "documento", label: "Documento" },
  { clave: "email", label: "Email" },
  { clave: "telefono", label: "Teléfono" },
  { clave: "fecha_ingreso", label: "Fecha de ingreso" },
];

export function ImportarPadronSociosPanel() {
  return (
    <ImportadorArchivoBase
      tipoPlantilla="socios"
      columnas={COLUMNAS_SOCIOS}
      accionPreview={previsualizarImportacionSocios}
      accionConfirmar={confirmarImportacionSocios}
    />
  );
}

const COLUMNAS_MOVIMIENTOS: Columna[] = [
  { clave: "tipo", label: "Tipo" },
  { clave: "monto", label: "Monto" },
  { clave: "categoria", label: "Categoría" },
  { clave: "fecha", label: "Fecha" },
  { clave: "descripcion", label: "Descripción" },
];

export function ImportarMovimientosPanel() {
  return (
    <ImportadorArchivoBase
      tipoPlantilla="movimientos"
      columnas={COLUMNAS_MOVIMIENTOS}
      accionPreview={previsualizarImportacionMovimientos}
      accionConfirmar={confirmarImportacionMovimientos}
    />
  );
}

// ---------------------------------------------------------------------
// Historial de importaciones + deshacer
// ---------------------------------------------------------------------

export function DeshacerImportacionBoton({ id }: { id: number }) {
  const [estado, formAction] = useActionState(deshacerImportacionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    else if (estado.ok) show("Importación deshecha.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton pendingLabel="Deshaciendo…" className="text-xs underline text-[var(--color-rojo)]">
        Deshacer
      </SubmitButton>
    </form>
  );
}
