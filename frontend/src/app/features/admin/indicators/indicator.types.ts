/**
 * Indicadores financieros anuales, vistos desde la pantalla de administración
 * (T108, FR-055…FR-062).
 *
 * `value` viaja como CADENA y no como número, igual que en el resto del contrato
 * (Principio VIII): es el dato que la plataforma existe para no redondear.
 */

export interface Indicator {
  indicator_id: string;
  name: string;
  value: string;
  /** Primer día de vigencia, INCLUSIVE. */
  valid_from: string;
  /** Primer día SIN vigencia (exclusivo). Vacío ⇒ sin fecha de fin. */
  valid_to: string;
  registered_by: string;
}

/** Cuerpo de alta y de corrección: el actor y el identificador no se eligen. */
export interface IndicatorInput {
  name: string;
  value: string;
  valid_from: string;
  valid_to: string;
}

/**
 * Una vigencia próxima a terminar (FR-061).
 *
 * `days_remaining` es un `int32` del contrato —un recuento de DÍAS, no una cifra
 * monetaria—, y por eso ESTE archivo queda fuera de la prohibición de `number` que
 * cubre la carpeta (`.eslintrc.json`). La prohibición sigue vigente para lo que
 * importa: `Indicator.value` es `string`, y las funciones que convierten (`Number`,
 * `parseFloat`) siguen prohibidas aquí y en toda la carpeta.
 *
 * Se documenta en el tipo y no con un `eslint-disable` en línea a propósito: un
 * `disable` se copia con el archivo y la razón se pierde, mientras que la excepción
 * declarada se lee de un tirón en la configuración.
 */
export interface ExpiringIndicator {
  name: string;
  valid_to: string;
  days_remaining: number;
}

/**
 * Estado del procedimiento anual.
 *
 * `missing_names` son los indicadores YA registrados que hoy no tienen vigencia. Un
 * indicador que nunca se ha cargado no aparece: de él no se puede decir que le falte
 * vigencia.
 */
export interface CalendarStatus {
  missing_names: string[];
  expiring: ExpiringIndicator[];
}
