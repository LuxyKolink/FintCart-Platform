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
}

export interface Page<T> {
  items: T[];
  next_page_token?: string;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- recuento de elementos, no un valor monetario (mismo patrón que `PointsCount`)
  total_size: number;
}
