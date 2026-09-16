import { formatScoreOutOf } from '../../shared/format-decimal';
import { InAppNotification } from '../profile/profile.types';
import { notificationTypeLabel } from './notification-labels';

/**
 * Texto legible de una entrada de la bandeja (FR-023, FR-106).
 *
 * QUÉ SE PUEDE DECIR Y QUÉ NO: el `payload` de cada notificación lo escribe quien la
 * publica —el Orquestador, en la saga de calificación— y sus claves están fijadas allí:
 *
 * | tipo                     | claves                          |
 * |--------------------------|---------------------------------|
 * | `resultado_cuestionario` | `quiz_id`, `attempt_id`, `score`, `passed` |
 * | `hito_progreso`          | `quiz_id`, `points`             |
 *
 * Ninguna trae el TÍTULO del cuestionario, así que no se inventa: se dice lo que sí se
 * sabe. Un texto genérico y cierto vale más que uno específico y falso (N-15).
 *
 * Los tipos `nuevo_articulo` y `recordatorio` están declarados en el `CHECK` de la tabla
 * y en Usuarios, pero **ningún productor los emite hoy**: si alguna vez llegan, caen a
 * su etiqueta y no a un hueco en blanco.
 */
export interface NotificationText {
  readonly title: string;
  readonly detail: string | null;
}

export function notificationText(item: InAppNotification): NotificationText {
  switch (item.type) {
    case 'resultado_cuestionario': {
      const score = asDecimalString(item.payload?.['score']);
      const passed = item.payload?.['passed'];
      if (score === null) {
        return { title: 'Tu cuestionario quedó calificado', detail: null };
      }
      const verdict = passed === true ? 'Aprobado' : 'Por debajo del umbral';
      // El puntaje viene como cadena decimal en el payload (Principio VIII): se
      // renderiza con el ayudante de frontera para no perder la escala.
      return {
        title: 'Tu cuestionario quedó calificado',
        detail: `${formatScoreOutOf(score)} · ${verdict}`,
      };
    }
    case 'hito_progreso': {
      const points = asCount(item.payload?.['points']);
      return {
        title: 'Alcanzaste un nuevo hito de puntos',
        detail: points === null ? null : `Llevas ${points} puntos acumulados`,
      };
    }
    default:
      return { title: notificationTypeLabel(item.type), detail: null };
  }
}

/**
 * Solo acepta la forma canónica del contrato. Un número JSON aquí sería un error del
 * emisor, y convertirlo con `String()` escondería justo la pérdida de precisión que el
 * Principio VIII prohíbe.
 */
function asDecimalString(value: unknown): string | null {
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/u.test(value) ? value : null;
}

function asCount(value: unknown): string | null {
  return typeof value === 'number' && Number.isInteger(value) ? value.toString() : null;
}
