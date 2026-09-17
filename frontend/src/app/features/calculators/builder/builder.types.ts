import {
  Calculator,
  CalculatorDefinition,
  CalculatorField,
  CalculatorInputType,
  CalculatorResult,
  CalculatorRule,
  CalculatorWriteBody,
  DefinitionIssue,
} from '../calculator.types';

/**
 * El modelo del constructor visual (T097, FR-043…FR-046).
 *
 * ## Por qué este archivo existe aparte del componente
 *
 * El constructor es un formulario con tres listas repetibles, y esa clase de componente acaba
 * mezclando dos cosas que conviene no mezclar: las REGLAS del modelo —qué es un borrador, cómo se
 * convierte en la forma del contrato, dónde cae un problema que el servidor señala— y el
 * cableado de Angular. Las reglas están aquí, son funciones puras y se prueban sin montar nada;
 * el componente solo las llama.
 *
 * ## El borrador es de CADENAS, y eso no es pereza
 *
 * Todo valor numérico de un campo —cota mínima, cota máxima, valor por defecto— vive en el
 * borrador como `string`, porque es lo que hay en el `<input>` mientras se escribe y porque
 * **convertirlo a `number` es exactamente lo que prohíbe el Principio VIII**: `Number('1e21')` y
 * `Number('100000000000000000000')` son el mismo número aproximado, y una cota que viaja
 * aproximada ya no es la que el autor escribió. Lo que se convierte —con `decimal.js`, en el
 * ejecutor— se convierte allí y a la vista.
 *
 * La única excepción es `scale`, y es legítima: es un RECUENTO de decimales de redondeo, no una
 * cifra monetaria, y el contrato lo declara `int32`.
 */

/** Una fila de entrada del constructor. */
export interface InputRow {
  key: string;
  label: string;
  type: CalculatorInputType;
  unit: string;
  min_value: string;
  max_value: string;
  default_value: string;
  required: boolean;
}

/** Una fila de regla de dominio. */
export interface RuleRow {
  expression: string;
  message: string;
}

/** Una fila de resultado calculado. */
export interface ResultRow {
  key: string;
  label: string;
  expression: string;
  /** Recuento de decimales, como texto mientras se escribe. */
  scale: string;
  when: string;
}

/** El borrador completo que el componente edita. */
export interface CalculatorDraft {
  name: string;
  description: string;
  inputs: InputRow[];
  validations: RuleRow[];
  outputs: ResultRow[];
}

/** Tipos de entrada admitidos, con su etiqueta (el vocabulario es del contrato). */
export const INPUT_TYPE_OPTIONS: { value: CalculatorInputType; label: string }[] = [
  { value: 'monto', label: 'Monto' },
  { value: 'tasa', label: 'Tasa' },
  { value: 'entero', label: 'Entero (meses, cuotas…)' },
];

/**
 * Unidades sugeridas.
 *
 * La unidad es TEXTO LIBRE en el contrato y el autor puede escribir la que quiera —«UVT»,
 * «smmlv»—; esta lista es la ayuda del desplegable, no un vocabulario cerrado. Presentarla como
 * cerrada obligaría a cambiar el contrato cada vez que aparezca una unidad nueva, y lo que se
 * enseña al usuario es la etiqueta del campo, no la unidad.
 */
export const UNIT_SUGGESTIONS: string[] = ['COP', '%', 'meses', 'años', 'UVT', 'veces'];

/** Un borrador vacío, con una fila de cada lista para que el formulario tenga dónde escribir. */
export function emptyDraft(): CalculatorDraft {
  return {
    name: '',
    description: '',
    inputs: [emptyInput('monto')],
    validations: [],
    outputs: [emptyResult('resultado')],
  };
}

export function emptyInput(key = ''): InputRow {
  return {
    key,
    label: '',
    type: 'monto',
    unit: 'COP',
    min_value: '',
    max_value: '',
    default_value: '',
    required: true,
  };
}

export function emptyRule(): RuleRow {
  return { expression: '', message: '' };
}

export function emptyResult(key = ''): ResultRow {
  return { key, label: '', expression: '', scale: '2', when: '' };
}

/**
 * El borrador que corresponde a una calculadora ya guardada, para editarla.
 *
 * Las cotas ausentes se rellenan con cadena vacía y no con `undefined`: el formulario tiene que
 * poder distinguir «sin cota» de «hay una cota y no la he cargado todavía», y una cadena vacía es
 * exactamente «sin cota» —así lo dice el contrato—.
 */
export function draftFrom(calculator: Calculator): CalculatorDraft {
  const definition = calculator.definition;
  return {
    name: calculator.name,
    description: calculator.description,
    inputs: definition.inputs.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      unit: field.unit,
      min_value: field.min_value ?? '',
      max_value: field.max_value ?? '',
      default_value: field.default_value ?? '',
      required: field.required,
    })),
    validations: definition.validations.map((rule) => ({
      expression: rule.expression,
      message: rule.message,
    })),
    outputs: definition.outputs.map((output) => ({
      key: output.key,
      label: output.label,
      expression: output.expression,
      scale: String(output.scale),
      when: output.when ?? '',
    })),
  };
}

/**
 * El cuerpo que espera el borde.
 *
 * ## Los campos vacíos se OMITEN, no se mandan vacíos
 *
 * El contrato dice que una cota ausente es una cota que no existe, y distingue el campo ausente
 * de la cadena vacía. Mandar `min_value: ''` sería afirmar algo distinto de no mandarlo, y el
 * Simulador tendría que adivinar cuál de las dos cosas quiso decir el autor. Por eso se omiten.
 *
 * ## `scale` se convierte a número, y las cotas no
 *
 * Es la única conversión numérica del constructor y se explica sola: la escala es un recuento de
 * decimales —un número entero pequeño—, no una cifra. Un `parseInt` que fallara se traduce a `0`
 * —redondear a la unidad— y el problema lo dirá la validación del servidor, que es quien tiene
 * el vocabulario de los errores; inventar aquí un mensaje daría dos formas de decir lo mismo.
 */
export function toWriteBody(draft: CalculatorDraft): CalculatorWriteBody {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    definition: {
      inputs: draft.inputs.map(toInput),
      validations: draft.validations.map(toRule),
      outputs: draft.outputs.map(toResult),
    },
  };
}

function toInput(row: InputRow): CalculatorField {
  const field: CalculatorField = {
    key: row.key.trim(),
    label: row.label.trim(),
    type: row.type,
    unit: row.unit.trim(),
    required: row.required,
  };
  if (row.min_value.trim() !== '') {
    field.min_value = row.min_value.trim();
  }
  if (row.max_value.trim() !== '') {
    field.max_value = row.max_value.trim();
  }
  if (row.default_value.trim() !== '') {
    field.default_value = row.default_value.trim();
  }
  return field;
}

function toRule(row: RuleRow): CalculatorRule {
  return { expression: row.expression.trim(), message: row.message.trim() };
}

function toResult(row: ResultRow): CalculatorResult {
  const result: CalculatorResult = {
    key: row.key.trim(),
    label: row.label.trim(),
    expression: row.expression.trim(),
    // `parseInt` y no `Number.parseInt`: la regla de ESLint prohíbe los ayudantes de coerción a
    // coma flotante —`Number`, `parseFloat`— sobre valores monetarios (Principio VIII), y deja
    // fuera `parseInt` a propósito porque un recuento de decimales SÍ es un entero. Escribirlo por
    // `Number` haría saltar la barrera en una línea correcta, y una barrera que se salta con
    // `eslint-disable` deja de proteger nada.
    scale: parseInt(row.scale, 10) || 0,
  };
  if (row.when.trim() !== '') {
    result.when = row.when.trim();
  }
  return result;
}

/**
 * La ruta del control de formulario a la que corresponde un problema del servidor.
 *
 * El servidor señala con la sintaxis del contrato —`inputs[1].expression`, `outputs[0].scale`— y
 * el `FormArray` de Angular se direcciona con puntos —`inputs.1.expression`—. Esta es la única
 * traducción entre los dos, y existe porque el valor de la ubicación es justo el que permite
 * resaltar el campo exacto en vez de mostrar un mensaje suelto.
 *
 * Devuelve `null` cuando el problema es de la definición entera —`definition`, `inputs` sin
 * índice— o cuando la ruta no tiene la forma esperada, y entonces se enseña en el panel general
 * sin marcar ningún campo: marcar uno al azar sería peor que no marcar ninguno.
 */
export function issueControlPath(location: string): string | null {
  const match = /^([a-z_]+)\[(\d+)\]\.([a-z_]+)$/.exec(location.trim());
  if (match === null) {
    return null;
  }
  const [, lista, index, campo] = match;
  if (lista !== 'inputs' && lista !== 'validations' && lista !== 'outputs') {
    return null;
  }
  return `${lista}.${index}.${campo}`;
}

/**
 * El texto que se enseña de un problema.
 *
 * Lleva la ubicación DELANTE y además del mensaje, porque el mismo problema puede aparecer en
 * varias filas —dos salidas con la misma clave— y sin la ubicación el autor no sabe cuál de las
 * dos está mal. Es la ubicación cruda del contrato y no una frase traducida: el constructor ya
 * resalta la fila, y decir «Resultado 2» aquí duplicaría una numeración que la pantalla no usa.
 */
export function describeIssue(issue: DefinitionIssue): string {
  const where = issue.location.trim() === '' ? 'definición' : issue.location.trim();
  return `${where}: ${issue.message}`;
}

/** La primera fila señalada por un problema, o `-1`. Sirve para llevar el foco al sitio. */
export function issueRowIndex(issue: DefinitionIssue): number {
  const match = /^\[(\d+)\]/.exec(issue.location.replace(/^[a-z_]+/, ''));
  return match === null ? -1 : parseInt(match[1], 10);
}

/** La definición del borrador, ya en la forma del contrato. Para la vista previa y las pruebas. */
export function toDefinition(draft: CalculatorDraft): CalculatorDefinition {
  return toWriteBody(draft).definition;
}
