import { formatMoney, formatRate } from '../../../shared/format-money';

/**
 * Cómo se LEE el valor de un indicador financiero (Principio VIII, nota N-15).
 *
 * ## El defecto que corrige
 *
 * La lista de vigencias imprimía `{{ indicador.value }}`, la cadena canónica que llega del
 * borde: `1600000`. Sin agrupado de miles y sin símbolo, esa cifra no se lee como un monto
 * —se lee como un identificador o como un error de teclado—. Y una cifra que el lector no
 * reconoce como dinero es, a efectos prácticos, un dato falso: el mismo daño que truncarla.
 *
 * ## Por qué la unidad se declara y no se adivina
 *
 * `financial_indicators` guarda `name` y `value` (`NUMERIC(20,6)`); NO guarda la unidad. El
 * nombre es texto libre con formato `@NOMBRE`, así que la única fuente de verdad sobre si
 * `0.05` son «cinco por ciento» o «cinco centavos» es el nombre del indicador. Deducirla del
 * VALOR sería peor que no deducirla: `400` es la UVR en pesos, y `0.05` es el IPC como
 * fracción, pero un monto de `0,50` y una tasa de `50 %` tendrían el mismo aspecto.
 *
 * De ahí las dos tablas de abajo. Son explícitas porque añadir un indicador con una unidad
 * nueva es una decisión de producto —¿se publica como monto o como tasa?— y no algo que deba
 * caer del lado de una heurística silenciosa.
 *
 * ## Un nombre desconocido se imprime TAL COMO LLEGA
 *
 * El cuarto rol puede registrar cualquier nombre (`ZZE2E...`, `SALARIO_INTEGRAL`). Para esos
 * no se inventa unidad: se muestra la cadena canónica sin tocar, dentro de `.fc-num`. Una
 * cifra sin símbolo es un dato incompleto; una cifra con el símbolo equivocado es un dato
 * falso, y el segundo error es el que no se puede permitir. Lo mismo si un nombre CONOCIDO
 * trae un valor que no cabe en la escala de su formateador (`1.234,567` en un monto): se
 * degrada a la cadena, nunca a una excepción que rompa la pantalla.
 */

/** Nombres cuyo valor es una FRACCIÓN de 1: `0.05` se lee «5 %». */
const RATE_NAMES: ReadonlySet<string> = new Set(['IPC', 'TASA_USURA']);

/** Nombres cuyo valor está denominado en pesos: `1600000` se lee «$1.600.000,00». */
const MONEY_NAMES: ReadonlySet<string> = new Set(['SMMLV', 'UVT', 'UVR']);

/**
 * Prefijos que ya declaran la unidad en el propio nombre. `TASA_*` es una tasa por
 * convención (el simulador siembra `TASA_USURA`), así que no hace falta enumerar cada
 * variante futura —`TASA_EA`, `TASA_NOMINAL`— una por una.
 */
const RATE_PREFIX = 'TASA';

export type IndicatorUnit = 'money' | 'rate' | 'unknown';

/** La unidad con la que se presenta un indicador, según su nombre. */
export function indicatorUnit(name: string): IndicatorUnit {
  const canonical = name.trim().toUpperCase();
  if (RATE_NAMES.has(canonical) || canonical.startsWith(RATE_PREFIX)) {
    return 'rate';
  }
  if (MONEY_NAMES.has(canonical)) {
    return 'money';
  }
  return 'unknown';
}

/**
 * El valor de un indicador listo para imprimirse.
 *
 * NO pasa por `Number`, `parseFloat` ni `toFixed`: los dos formateadores trabajan sobre la
 * cadena canónica con `decimal.js` (ver `shared/format-money.ts`). El `try` no es defensivo
 * por pereza —`formatMoney` lanza a propósito cuando el valor excede la escala del
 * formateador, porque redondear en la capa de presentación esconde una pérdida de precisión—
 * sino para que un valor fuera de escala se degrade a su cadena en vez de dejar la tabla en
 * blanco.
 */
export function formatIndicatorValue(name: string, value: string): string {
  try {
    switch (indicatorUnit(name)) {
      case 'rate':
        return formatRate(value);
      case 'money':
        return formatMoney(value);
      case 'unknown':
        return value;
    }
  } catch {
    return value;
  }
}
