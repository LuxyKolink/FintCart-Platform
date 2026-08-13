/**
 * `points` es un conteo entero (FR-014), no un monto ni una calificación —
 * pero este directorio cae bajo la regla `no-restricted-types` de
 * `.eslintrc.json` (Principio VIII) igual que `shared/decimal-str.ts`. Mismo
 * mecanismo de excepción que `DigitCount` allí: el alias documenta que el
 * `number` que sigue es un recuento, no dinero.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- recuento de puntos (FR-014), no un valor monetario
export type PointsCount = number;

export interface Progress {
  user_id: string;
  points: PointsCount;
}
