import * as decimalStr from './decimal-str';

/** Umbral de «buen puntaje» del historial, en la misma representación del contrato. */
const GOOD_SCORE = '80';

/**
 * Presentación de una calificación decimal (Principio VIII, prueba T040).
 *
 * Vive en `shared/` —y no dentro de `features/learning/`— porque la usan pantallas de
 * DOS features: el cuestionario y el progreso (aprendizaje) y la bandeja de
 * notificaciones, que muestra el puntaje que trae el evento de calificación. Dejarla en
 * una de las dos obligaría a la otra a importar de un feature ajeno.
 *
 * POR QUÉ NO ES UN `number`: `score` cruza la frontera como cadena decimal canónica.
 * Pasarlo por `Number` y volver a mostrarlo es exactamente el redondeo silencioso que
 * el Principio VIII prohíbe —`Number('85.15')` es representable, pero en cuanto se
 * sume, se compare o se formatee con `toFixed` el valor puede dejar de ser el que el
 * servidor calificó—. Aquí se usa el ayudante de frontera del proyecto, que interpreta
 * con `decimal.js` y vuelve a serializar sin tocar la escala.
 *
 * La escala se conserva: `"85.50"` se muestra «85.5» (mismo valor, ceros finales
 * fuera), pero **nunca** se trunca a entero. Una calificación truncada no es texto
 * incompleto: es una calificación distinta (nota N-15, la misma regla que protege a
 * una cifra monetaria).
 *
 * Si la cadena no es canónica se devuelve TAL CUAL en lugar de lanzar: es preferible
 * enseñar un dato raro a dejar la pantalla en blanco por un valor que no controlamos.
 */
export function formatScore(score: string): string {
  try {
    return decimalStr.format(decimalStr.parseScore(score));
  } catch {
    return score;
  }
}

/**
 * ¿Es una calificación que merece destacarse en el historial?
 *
 * La comparación se hace en la MISMA escala decimal que el dato —con `decimal.js`, a
 * través del ayudante de frontera— y no con `Number`/`parseFloat`: comparar una
 * calificación con coma flotante es el atajo que el Principio VIII existe para impedir,
 * aunque este directorio no esté entre los que la regla de lint cubre.
 */
export function isGoodScore(score: string): boolean {
  try {
    return decimalStr.parseScore(score).gte(decimalStr.parse(GOOD_SCORE));
  } catch {
    return false;
  }
}

/** La misma calificación con su denominador: «85.5 de 100». */
export function formatScoreOutOf(score: string, outOf = '100'): string {
  return `${formatScore(score)} de ${outOf}`;
}
