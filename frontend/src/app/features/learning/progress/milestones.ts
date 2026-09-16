import { PointsCount } from './progress.types';

/**
 * Hitos de puntaje (FR-014): cada 100 puntos se cierra un hito y la barra vuelve a
 * empezar. Vive aquí y no dentro de `ProgressComponent` porque la pantalla de progreso
 * **y** el riel del catálogo muestran el mismo avance, y dos copias de la aritmética
 * del hito podrían divergir en el redondeo sin que ninguna prueba lo note.
 */
export const MILESTONE = 100;

/** Puntos conseguidos DENTRO del hito actual (0–100), que es lo que pinta la barra. */
export function withinMilestone(points: PointsCount): PointsCount {
  return points % MILESTONE;
}

/** Puntos del inicio del hito actual (0, 100, 200…). */
export function currentMilestone(points: PointsCount): PointsCount {
  return Math.floor(points / MILESTONE) * MILESTONE;
}

/** Puntos del siguiente hito. */
export function nextMilestone(points: PointsCount): PointsCount {
  return currentMilestone(points) + MILESTONE;
}
