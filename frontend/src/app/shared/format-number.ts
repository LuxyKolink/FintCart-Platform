/**
 * Presentación de cifras en español de Colombia.
 *
 * POR QUÉ NO `toLocaleString('es-CO')`: los valores cruzan la frontera como **cadena
 * decimal canónica** (Principio VIII), y `toLocaleString` obliga a pasar por `number`.
 * Para un monto de 16 dígitos eso pierde precisión silenciosamente —el caso que
 * `result-format.spec.ts` fija con 2⁵³+1—. Agrupar la cadena ya canónica da el mismo
 * resultado sin tocar el valor.
 *
 * LA CONVENCIÓN NO ES ESTILO, ES IDIOMA: el manual de voz y tono
 * (`design/guidelines/brand-voice.html`) escribe «1.250.000» y los cinco kits de
 * `design/ui_kits/` formatean con `toLocaleString('es-CO')`. El punto agrupa los miles y
 * la coma separa los decimales; al revés —como se hacía— la misma cifra se lee como si
 * fuera otra (1,234 = mil doscientos treinta y cuatro en Colombia).
 */
export function toColombian(canonical: string): string {
  const [integer = '0', decimals] = canonical.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return decimals === undefined || decimals === '' ? grouped : `${grouped},${decimals}`;
}

/** Un entero de la interfaz (puntos, conteos) con el agrupado de miles local. */
export function formatInteger(value: number): string {
  return Number.isFinite(value) ? toColombian(String(Math.trunc(value))) : String(value);
}
