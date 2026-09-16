import * as decimalStr from '../../shared/decimal-str';
import { toColombian } from '../../shared/format-number';

/**
 * Formato de PRESENTACIÓN de un resultado — nunca de transporte ni de cálculo. Todo
 * pasa por `decimal-str.ts` (decimal.js); el agrupado de miles lo hace `format-number.ts`
 * sobre la cadena YA canónica, sin convertir nunca a `number` — ni siquiera para
 * mostrar, porque un monto puede exceder `Number.MAX_SAFE_INTEGER` sin dejar de ser un
 * `NUMERIC(19,2)` válido (Principio VIII).
 */
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
