import { normalizarNombre } from "@/lib/plataformaCoop";

/**
 * Parsers de las cargas en lote del panel de plataforma. Viven fuera de
 * actions/plataformaCooperativa.ts porque un archivo "use server" solo puede
 * exportar funciones async.
 */

/**
 * Carga en lote: una línea por núcleo, "N.º  Nombre" (separado por espacio,
 * tab, punto y coma, coma o guion). Todo o nada: si una línea está mal o
 * repetida, no se carga ninguna y se informa cuáles.
 */
export function parsearNucleosEnLote(texto: string): { filas: { linea: number; numero: number; nombre: string }[]; errores: string[] } {
  const filas: { linea: number; numero: number; nombre: string }[] = [];
  const errores: string[] = [];
  const numerosVistos = new Map<number, number>();
  const nombresVistos = new Map<string, number>();
  texto.split(/\r?\n/).forEach((crudo, i) => {
    const linea = i + 1;
    const l = crudo.trim();
    if (!l) return;
    const m = l.match(/^(\d{1,5})\s*[;,\t.\-–—:|]*\s*(.+)$/);
    if (!m) {
      errores.push(`Línea ${linea}: no se entiende «${l}». Usá el formato «4 Nombre Apellido».`);
      return;
    }
    const numero = Number(m[1]);
    const nombre = m[2].trim().replace(/\s+/g, " ");
    if (numero < 1) {
      errores.push(`Línea ${linea}: el número de núcleo tiene que ser mayor que 0.`);
      return;
    }
    if (nombre.length > 200 || /^[\d\s.\-]+$/.test(nombre)) {
      errores.push(`Línea ${linea}: el nombre «${nombre}» no es válido.`);
      return;
    }
    const repNum = numerosVistos.get(numero);
    if (repNum) {
      errores.push(`Línea ${linea}: el núcleo N.º ${numero} ya está en la línea ${repNum}.`);
      return;
    }
    const norm = normalizarNombre(nombre);
    const repNom = nombresVistos.get(norm);
    if (repNom) {
      errores.push(`Línea ${linea}: «${nombre}» ya está en la línea ${repNom}.`);
      return;
    }
    numerosVistos.set(numero, linea);
    nombresVistos.set(norm, linea);
    filas.push({ linea, numero, nombre });
  });
  return { filas, errores };
}

export function parsearComisionesEnLote(texto: string): { grupos: { linea: number; comision: string; personas: string[] }[]; errores: string[] } {
  const grupos: { linea: number; comision: string; personas: string[] }[] = [];
  const errores: string[] = [];
  texto.split(/\r?\n/).forEach((crudo, i) => {
    const linea = i + 1;
    const l = crudo.trim();
    if (!l) return;
    const corte = l.indexOf(":");
    if (corte < 1) {
      errores.push(`Línea ${linea}: usá el formato «Nombre de la comisión: Persona 1, Persona 2».`);
      return;
    }
    const comision = l.slice(0, corte).trim().replace(/\s+/g, " ");
    const personas = l
      .slice(corte + 1)
      .split(/[,;]/)
      .map((p) => p.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (!personas.length) {
      errores.push(`Línea ${linea}: la comisión «${comision}» no tiene ninguna persona.`);
      return;
    }
    const vistos = new Set<string>();
    for (const p of personas) {
      const n = normalizarNombre(p);
      if (vistos.has(n)) errores.push(`Línea ${linea}: «${p}» está repetida en «${comision}».`);
      vistos.add(n);
    }
    grupos.push({ linea, comision, personas });
  });
  return { grupos, errores };
}
