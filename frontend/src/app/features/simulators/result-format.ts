import * as decimalStr from '../../shared/decimal-str';

/**
 * Formato de PRESENTACIÓN de un resultado — nunca de transporte ni de cálculo. Todo
 * pasa por `decimal-str.ts` (decimal.js); el agrupado de miles se hace con una regex
 * sobre la parte entera YA canónica, sin convertir nunca a `number` — ni siquiera para
 * mostrar, porque un monto puede exceder `Number.MAX_SAFE_INTEGER` sin dejar de ser un
 * `NUMERIC(19,2)` válido (Principio VIII).
 */
export function formatMoney(raw: string): string {
  const value = decimalStr.parseMoney(raw);
  const canonical = decimalStr.formatFixed(value, 2);
  const negative = canonical.startsWith('-');
  const [intPart, decPart] = (negative ? canonical.slice(1) : canonical).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `${negative ? '-' : ''}$${grouped}.${decPart}`;
}

/** Convierte una fracción canónica (`"0.12"`) a porcentaje legible (`"12%"`). */
export function formatRate(raw: string): string {
  const value = decimalStr.parseRate(raw);
  return `${decimalStr.format(value.times(100))}%`;
}
