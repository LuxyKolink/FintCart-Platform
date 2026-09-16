import { CalculatorMode, FieldKind, ResultKind, calculatorFor } from './calculators.config';
import * as resultFormat from './result-format';
import { SimulationHistoryEntry } from './simulators.types';

/**
 * Traducción de una entrada de historial a filas legibles.
 *
 * Vive fuera de la pantalla de historial porque la usan DOS sitios: el historial completo
 * y el resumen de las últimas simulaciones que acompaña al formulario. Dos copias de este
 * mapeo acabarían llamando «Monto» a lo que la otra llama «Monto del crédito», y una de
 * las dos se quedaría atrás cuando cambie `calculators.config.ts`.
 */

export interface Row {
  label: string;
  value: string;
}

/** Nombre visible de la calculadora; si el `calc_type` ya no existe, se muestra crudo. */
export function calcLabelOf(entry: SimulationHistoryEntry): string {
  return calculatorFor(entry.calc_type)?.label ?? entry.calc_type;
}

export function inputRows(entry: SimulationHistoryEntry): Row[] {
  const mode = modeFor(entry);
  return Object.entries(entry.inputs)
    // `operacion` elige el modo, no es un parámetro que el usuario escriba: mostrarlo
    // como si lo hubiera tecleado confundiría la lectura del historial.
    .filter(([key]) => key !== 'operacion')
    .map(([key, value]) => {
      const field = mode?.fields.find((candidate) => candidate.key === key);
      return { label: field?.label ?? key, value: formatValue(value, field?.kind) };
    });
}

export function resultRows(entry: SimulationHistoryEntry): Row[] {
  const mode = modeFor(entry);
  return Object.entries(entry.result).map(([key, value]) => {
    const field = mode?.resultFields.find((candidate) => candidate.key === key);
    return { label: field?.label ?? key, value: formatValue(value, field?.kind) };
  });
}

/**
 * La cifra que resume la simulación: el PRIMER campo de resultado de su calculadora, en el
 * orden en que `calculators.config.ts` los declara —el mismo criterio que la pantalla de
 * resultado usa para destacar la fila principal—. Sin la configuración no hay forma de saber
 * cuál de las claves es la principal, así que se toma la primera del propio mapa.
 */
export function primaryResult(entry: SimulationHistoryEntry): Row {
  const mode = modeFor(entry);
  const first = mode?.resultFields[0];
  if (first !== undefined && entry.result[first.key] !== undefined) {
    return { label: first.label, value: formatValue(entry.result[first.key], first.kind) };
  }
  const [key, value] = Object.entries(entry.result)[0] ?? ['', ''];
  return { label: key, value };
}

/**
 * Resuelve el modo de una entrada. Para `colombia_especifica` hay tres modos y el elegido
 * viaja dentro de `inputs.operacion`; para el resto hay uno solo.
 */
export function modeFor(entry: SimulationHistoryEntry): CalculatorMode | undefined {
  const definition = calculatorFor(entry.calc_type);
  if (definition === undefined) {
    return undefined;
  }
  if (definition.modes.length === 1) {
    return definition.modes[0];
  }
  const operation = entry.inputs['operacion'];
  return definition.modes.find((mode) => mode.value === operation) ?? definition.modes[0];
}

export function formatValue(raw: string, kind: FieldKind | ResultKind | undefined): string {
  try {
    if (kind === 'money') {
      return resultFormat.formatMoney(raw);
    }
    if (kind === 'rate') {
      return resultFormat.formatRate(raw);
    }
  } catch {
    // Un valor histórico que ya no cumple el formato canónico se muestra tal cual en lugar
    // de romper toda la fila.
  }
  return raw;
}
