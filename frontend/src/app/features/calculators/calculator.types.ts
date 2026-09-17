import { BadgeTone } from '../../shared/ui';

/**
 * Tipos del constructor de calculadoras (FR-043…FR-054).
 *
 * Se declaran en `features/calculators/` y no en `features/simulators/` porque son de OTRA
 * pantalla: los simuladores ejecutan las calculadoras que ya existen, y esto describe las que
 * un usuario escribe. Lo que sí comparten —`HistoryEntry`— vive donde está el historial.
 *
 * **Principio VIII**: todo valor numérico de una definición viaja como `string` decimal
 * (`min`, `max`, `default`), nunca como `number`. `scale` es la excepción y es legítima: es un
 * RECUENTO de decimales de redondeo, no una cifra.
 */
export type CalculatorState = 'privada' | 'en_revision' | 'publicada';

/** Tipo de una entrada. No hay tipo texto: el único campo de texto del sistema desapareció
 * con el discriminador `operacion` (research D-16), y sus tres calculadoras viven ahora en
 * definiciones separadas. */
export type CalculatorInputType = 'monto' | 'tasa' | 'entero';

export interface CalculatorField {
  key: string;
  label: string;
  type: CalculatorInputType;
  unit: string;
  /** Cadenas decimales, o ausentes cuando no hay cota. */
  min?: string;
  max?: string;
  default?: string;
  required: boolean;
}

export interface CalculatorRule {
  expression: string;
  message: string;
}

export interface CalculatorResult {
  key: string;
  label: string;
  expression: string;
  scale: number;
  when?: string;
}

export interface CalculatorDefinition {
  inputs: CalculatorField[];
  validations: CalculatorRule[];
  outputs: CalculatorResult[];
}

export interface Calculator {
  calculator_id: string;
  owner_id?: string;
  name: string;
  description: string;
  is_builtin: boolean;
  state: CalculatorState;
  approved_by?: string;
  /** Motivo del último rechazo (FR-054). Vacío si nunca se rechazó. */
  rejection_reason?: string;
  version: number;
  definition: CalculatorDefinition;
  indicators_used: string[];
}

/** Resultado de aprobar: la versión que quedó publicada (FR-053). */
export interface CalculatorApproval {
  calculator_id: string;
  version: number;
}

/** Error clasificado de una llamada de curaduría. */
export type CalculatorErrorKind = 'offline' | 'forbidden' | 'notFound' | 'invalid' | 'server';

/**
 * Presentación de los estados de curaduría (FR-051…FR-053).
 *
 * Igual que `version-state.ts` en editorial y por el mismo motivo: la lista de las propias,
 * la bandeja del coordinador y el catálogo muestran los mismos tres estados, y dos tablas de
 * traducción acabarían llamando «Pendiente» a lo que la otra llama «En revisión» — que es
 * información falsa para quien revisa.
 */
const STATE_PRESENTATION: Record<CalculatorState, { label: string; tone: BadgeTone; help: string }> = {
  privada: {
    label: 'Privada',
    tone: 'neutral',
    help: 'Solo la ves tú. Puedes ejecutarla, pero no aparece en el catálogo ni en un artículo.',
  },
  en_revision: {
    label: 'En revisión',
    tone: 'warning',
    help: 'Un coordinador editorial la está mirando. Mientras espera no puedes editarla sin retirar la propuesta.',
  },
  publicada: {
    label: 'Publicada',
    tone: 'success',
    help: 'Está en el catálogo público y puede incrustarse en un artículo.',
  },
};

/** Etiqueta visible del estado. Un estado desconocido se muestra tal cual, no se inventa. */
export function calculatorStateLabel(state: CalculatorState | string): string {
  return STATE_PRESENTATION[state as CalculatorState]?.label ?? state;
}

export function calculatorStateTone(state: CalculatorState | string): BadgeTone {
  return STATE_PRESENTATION[state as CalculatorState]?.tone ?? 'neutral';
}

/** Qué significa el estado, en una frase. */
export function calculatorStateHelp(state: CalculatorState | string): string {
  return STATE_PRESENTATION[state as CalculatorState]?.help ?? '';
}

/**
 * Si la calculadora se puede proponer para el catálogo.
 *
 * Es una AYUDA visual, no la regla: quien la impone es el Simulador, y una propuesta sin nada
 * que proponer se rechaza allí con un mensaje que explica qué falta. Aquí solo se evita
 * ofrecer el botón cuando el estado lo hace imposible con seguridad —en revisión ya está
 * propuesta, y una semilla de la plataforma no se propone—.
 */
export function canBeSubmitted(calculator: Calculator): boolean {
  return !calculator.is_builtin && calculator.state !== 'en_revision';
}
