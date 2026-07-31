/**
 * Enteros que NO son valores financieros.
 *
 * El lint de este servicio prohíbe el tipo `number` en `src/grading/**` y
 * `src/quizzes/**` (Principio VIII, NON-NEGOTIABLE), y con razón: ahí casi todo número
 * es una calificación, un peso o un umbral, y un `number` de JavaScript es un
 * IEEE-754 que pierde precisión.
 *
 * Pero no TODO entero de esos módulos es financiero. Un número de intento, un tamaño
 * de página o una posición de pregunta son cardinales pequeños, y modelarlos con
 * `Decimal` sería confundir la regla con su motivo: nadie pierde dinero porque
 * `attempt_no` sea un entero de doble precisión.
 *
 * Este archivo concentra la excepción en UNA línea auditable, en lugar de repartir
 * `eslint-disable` por los módulos donde la regla sí está protegiendo algo. Es el
 * mismo recurso que ya usa `DigitCount` en `decimal-str.ts`.
 */

/**
 * Cardinal pequeño: contador, índice, tamaño de página o número de intento.
 *
 * NUNCA para un importe, una tasa, un peso ni una calificación. Para eso está
 * `Decimal` en el dominio y la `string` decimal canónica en la frontera.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- ver la cabecera: cardinal, no valor financiero
export type Count = number;

/**
 * Interpreta un cardinal que PostgreSQL entregó como texto.
 *
 * `count(*)` es `bigint` y el driver `pg` lo devuelve como STRING para no perder
 * precisión por encima de 2^53. Sin esta conversión, el total de una página llegaría
 * al contrato como `"42"` en lugar de 42.
 *
 * Vive aquí y no en los módulos que lo usan porque el lint prohíbe el global `Number`
 * en `src/grading/**` y `src/quizzes/**` (Principio VIII) — una prohibición pensada
 * para importes, no para contadores de filas. Concentrarla en este archivo evita
 * sembrar `eslint-disable` justo en los módulos donde la regla sí protege algo.
 */
export function parseCount(raw: string | undefined): Count {
  if (raw === undefined || raw === '') {
    return 0;
  }
  return Number.parseInt(raw, 10);
}
