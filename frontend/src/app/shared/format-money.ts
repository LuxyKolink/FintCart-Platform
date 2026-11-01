import * as decimalStr from './decimal-str';
import { toColombian } from './format-number';

/**
 * Presentación de una cifra monetaria y de una tasa (Principio VIII, nota N-15).
 *
 * Vive en `shared/` por la misma razón que `format-decimal.ts`: la usan pantallas de
 * VARIOS features —el simulador y su historial, el panel de administración, los
 * indicadores anuales—, y dejarla dentro de `features/simulators/` obligaría a los
 * demás a importar de un feature ajeno, que es la frontera que el Principio IX prohíbe
 * cruzar. Nació allí (`features/simulators/result-format.ts` sigue reexportándolo para
 * no romper a quien ya lo importaba) y se mudó aquí cuando la administración empezó a
 * imprimir montos.
 *
 * POR QUÉ NO ES UN `number`: un monto cruza la frontera como cadena decimal canónica y
 * puede exceder `Number.MAX_SAFE_INTEGER` sin dejar de ser un `NUMERIC(19,2)` válido.
 * Ni siquiera para mostrar se convierte: se interpreta con `decimal.js`, se fija la
 * escala y el agrupado de miles se hace SOBRE LA CADENA. `Number(...).toLocaleString()`
 * habría sido una línea de código y una violación del Principio VIII.
 *
 * UNA CIFRA MONETARIA NUNCA SE TRUNCA (N-15). Si el ancho no alcanza, se rompe la línea
 * o se cambia la disposición; recortar `$1.234.567` a `$1.234…` no es texto incompleto,
 * es un dato falso. Por eso estas funciones devuelven la cadena completa y quien las
 * consume no debe envolverlas en `text-overflow: ellipsis` ni en un ancho fijo.
 */

/** Monto en pesos con símbolo, agrupado de miles local y dos decimales. */
export function formatMoney(raw: string): string {
  const value = decimalStr.parseMoney(raw);
  const canonical = decimalStr.formatFixed(value, 2);
  const negative = canonical.startsWith('-');
  return `${negative ? '-' : ''}$${toColombian(negative ? canonical.slice(1) : canonical)}`;
}

/**
 * Convierte una fracción canónica (`"0.12"`) a porcentaje legible (`"12 %"`).
 *
 * Lleva espacio antes del signo porque así lo pide la norma y así lo dibuja el kit
 * (`12,50 %`); el porcentaje no es una medida pegada al número como el grado.
 */
export function formatRate(raw: string): string {
  const value = decimalStr.parseRate(raw);
  return `${toColombian(decimalStr.format(value.times(100)))} %`;
}
