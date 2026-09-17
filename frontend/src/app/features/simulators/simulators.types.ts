/** DTOs de simuladores — espejo de `services/api-gateway/internal/handler/types.go`. */

export type CalcType = 'ahorro' | 'credito' | 'presupuesto' | 'inversion' | 'colombia_especifica';

export interface SimulationRequest {
  currency: string;
  inputs: Record<string, string>;
}

/** `result` son valores decimales canónicos (Principio VIII) — nunca `number`. */
export interface SimulationResult {
  simulation_id: string;
  result: Record<string, string>;
}

export interface SimulationHistoryEntry {
  simulation_id: string;
  calc_type: CalcType;
  currency: string;
  inputs: Record<string, string>;
  result: Record<string, string>;
  created_at: string;

  /**
   * Procedencia de la simulación (FR-050, FR-058).
   *
   * `calculator_id`/`calculator_version` dicen con qué definición se calculó —una
   * definición cambia con el tiempo y, sin la versión, una simulación de hace un año se
   * explicaría con la fórmula de hoy—, y `indicators_used` guarda los valores de
   * indicador resueltos ese día.
   *
   * Los tres van siempre presentes: una simulación anterior a la enmienda los trae
   * vacíos o en cero, y eso es información —no se calculó con una definición que se
   * pueda citar—, no un hueco que haya que esconder.
   */
  calculator_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- número de VERSIÓN, no un valor monetario (mismo patrón que `total_size`)
  calculator_version?: number;
  indicators_used?: Record<string, string>;
}

/**
 * Un valor de indicador vigente, tal como lo publica `GET /indicators/current`.
 *
 * `value` es cadena decimal (Principio VIII). `valid_to` vacío significa «sin fecha de
 * fin», que es la convención del contrato.
 */
export interface CurrentIndicator {
  name: string;
  value: string;
  valid_from: string;
  valid_to: string;
}

/**
 * Respuesta de `GET /indicators/current` (FR-062).
 *
 * `missing_names` son los indicadores YA registrados que hoy no tienen vigencia: un
 * indicador que nunca se cargó no aparece, porque de él no se puede decir que le falte
 * vigencia.
 */
export interface CurrentIndicators {
  indicators: CurrentIndicator[];
  missing_names: string[];
}

export interface Page<T> {
  items: T[];
  next_page_token?: string;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- recuento de elementos, no un valor monetario (mismo patrón que `PointsCount`)
  total_size: number;
}
