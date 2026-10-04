/**
 * Mejora global de validaciones (pedido del 28/09, secciones 3-14) — revisión
 * del 04/10: los textos y reglas de formato en UN solo lugar, compartidos por
 * el servidor (src/lib/validation.ts, Zod) y el navegador
 * (ValidacionEnFormularios en src/components/ui-client.tsx). Sin esto, el
 * mismo error se decía distinto según dónde se detectara ("Email inválido."
 * en un lado, "Ingresá un email válido." en otro, el globito del navegador
 * "Completa este campo" en un tercero).
 *
 * Archivo sin dependencias (ni Zod ni React) a propósito: se importa desde
 * código de cliente y de servidor por igual.
 */

export const MENSAJES = {
  obligatorio: "Este campo es obligatorio.",
  nombre: "Ingresá un nombre válido.",
  documento: "Ingresá un número de documento válido.",
  telefono: "Ingresá un número de teléfono válido.",
  email: "Ingresá un correo electrónico válido.",
  numero: "Ingresá un valor numérico válido.",
  fecha: "Ingresá una fecha válida.",
  fechaHora: "Ingresá una fecha y hora válidas.",
} as const;

/** Un nombre que es 100% dígitos ("123456") claramente no es un nombre. */
export function esNombreValido(v: string): boolean {
  return !/^\d+$/.test(v.trim());
}

/** Documento: sólo dígitos más puntos/guiones/espacios de formato (respeta
 * "1.234.567-8"), con al menos 5 dígitos reales. */
export function esDocumentoValido(v: string): boolean {
  const t = v.trim();
  return /^[\d.\-\s]+$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= 5;
}

/** Teléfono: laxo a propósito ("+598 99 123 456", "(02) 2900-1234"), sólo
 * rechaza letras o muy pocos dígitos reales. */
export function esTelefonoValido(v: string): boolean {
  const t = v.trim();
  return /^[+\d][\d\s()-]{5,49}$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= 6;
}
