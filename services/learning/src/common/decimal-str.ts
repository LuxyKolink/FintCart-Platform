/**
 * Tipo lógico `DecimalString` de los contratos (research D-10): la
 * representación canónica con la que TODO monto, tasa, peso o calificación cruza
 * una frontera —gRPC, REST o JSON—.
 *
 * El Principio VIII (NON-NEGOTIABLE) prohíbe `number` para estos valores: un
 * `number` de JavaScript es un IEEE-754 de doble precisión, así que `0.1 + 0.2`
 * no da `0.3` y una calificación o un monto en COP puede perder centavos. El
 * transporte es por tanto `string`, y este módulo es el único lugar del servicio
 * donde esa `string` se convierte a `Decimal` y vuelta.
 *
 * El formato canónico es EXACTAMENTE `^-?\d+(\.\d+)?$`:
 *
 * | entrada        | resultado                            |
 * |----------------|--------------------------------------|
 * | `"1500000.00"` | válido                               |
 * | `"-0.5"`       | válido                               |
 * | `"1.5e3"`      | RECHAZADO — notación científica      |
 * | `"1,500.00"`   | RECHAZADO — separador de miles       |
 * | `"+1.5"`       | RECHAZADO — signo positivo explícito |
 * | `".5"` / `"5."`| RECHAZADO — falta un lado del punto  |
 * | `" 1.5"`       | RECHAZADO — espacios                 |
 *
 * Rechazar en lugar de normalizar es deliberado: si dos servicios discrepan en
 * la escala o el formato de un valor, queremos un error en la frontera y no un
 * dato silenciosamente distinto en la base de datos.
 */
import Decimal from 'decimal.js';

/**
 * Cantidad de dígitos (precisión o escala de una columna `NUMERIC`).
 *
 * Existe para poder tipar los contadores de dígitos sin usar `number` en cada
 * firma: el lint de este archivo prohíbe el tipo `number` (Principio VIII), y con
 * razón, porque aquí `number` casi siempre sería un valor monetario mal tipado.
 * Un contador de dígitos NO es un valor financiero —es un entero pequeño que
 * describe una columna— así que la excepción se concentra en esta única línea,
 * donde queda documentada y auditable, en lugar de repartirse por el archivo.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- ver el comentario de arriba: contador de dígitos, no un valor monetario
export type DigitCount = number;

/** Límites de las columnas `NUMERIC` de data-model.md §Convenciones. */
export const LIMITS = {
  /** Montos (COP): `NUMERIC(19,2)`. */
  money: { precision: 19 as DigitCount, scale: 2 as DigitCount },
  /** Tasas y porcentajes: `NUMERIC(9,6)`. */
  rate: { precision: 9 as DigitCount, scale: 6 as DigitCount },
  /** Calificaciones, pesos y umbrales: `NUMERIC(6,2)`. */
  score: { precision: 6 as DigitCount, scale: 2 as DigitCount },
} as const;

/** Motivo por el que una `DecimalString` fue rechazada. */
export type DecimalStrErrorCode =
  /** Cadena vacía. */
  | 'empty'
  /** No respeta `^-?\d+(\.\d+)?$`. */
  | 'syntax'
  /** Más decimales significativos de los que admite la columna destino. */
  | 'scale'
  /** La parte entera no cabe en la columna destino. */
  | 'range';

/**
 * Error de interpretación o serialización de una `DecimalString`.
 *
 * Lleva un `code` discriminante para que la capa gRPC distinga un problema de
 * formato (dato mal construido por el emisor) de uno de rango (dato bien formado
 * que no cabe en la columna): ameritan respuestas distintas.
 */
export class DecimalStrError extends Error {
  public readonly code: DecimalStrErrorCode;

  public constructor(code: DecimalStrErrorCode, message: string) {
    super(message);
    this.name = 'DecimalStrError';
    this.code = code;
  }
}

/**
 * Única sintaxis aceptada.
 *
 * Se comprueba ANTES de entregar la cadena a decimal.js: su constructor acepta
 * de buen grado notación científica (`"1e5"`), signo positivo, `"Infinity"` y
 * `"NaN"`, que aquí no son canónicos.
 */
const CANONICAL = /^-?\d+(\.\d+)?$/;

/**
 * Convierte una cadena decimal canónica en `Decimal`.
 *
 * No impone límite de precisión: para validar contra una columna concreta usar
 * {@link parseMoney}, {@link parseRate}, {@link parseScore} o
 * {@link parseNumeric}.
 *
 * @throws {DecimalStrError} con code `empty` o `syntax`.
 */
export function parse(s: string): Decimal {
  if (s === '') {
    throw new DecimalStrError('empty', 'decimal-str: cadena vacía');
  }
  if (!CANONICAL.test(s)) {
    throw new DecimalStrError(
      'syntax',
      `decimal-str: formato no canónico: ${JSON.stringify(s)}`,
    );
  }
  return new Decimal(s);
}

/**
 * Como {@link parse}, y además exige que el valor quepa en una columna
 * `NUMERIC(precision, scale)` de PostgreSQL.
 *
 * La escala se mide sobre los decimales SIGNIFICATIVOS: `"1.500"` cuenta como
 * escala 1, no 3, porque los ceros a la derecha no aportan precisión y
 * rechazarlos solo castigaría a un emisor que rellena a un ancho fijo.
 *
 * @throws {DecimalStrError} con code `empty`, `syntax`, `scale` o `range`.
 */
export function parseNumeric(
  s: string,
  precision: DigitCount,
  scale: DigitCount,
): Decimal {
  const d = parse(s);

  const got = significantScale(s);
  if (got > scale) {
    throw new DecimalStrError(
      'scale',
      `decimal-str: escala excedida: ${JSON.stringify(s)} tiene ${got} decimales, el máximo es ${scale}`,
    );
  }

  // Cota exacta de PostgreSQL: |valor| < 10^(precision-scale).
  const maxAbs = new Decimal(10).pow(precision - scale);
  if (d.abs().gte(maxAbs)) {
    throw new DecimalStrError(
      'range',
      `decimal-str: fuera de rango: ${JSON.stringify(s)} excede NUMERIC(${precision},${scale})`,
    );
  }

  return d;
}

/**
 * Valida un monto contra `NUMERIC(19,2)`.
 *
 * @throws {DecimalStrError} ver {@link parseNumeric}.
 */
export function parseMoney(s: string): Decimal {
  return parseNumeric(s, LIMITS.money.precision, LIMITS.money.scale);
}

/**
 * Valida una tasa o porcentaje contra `NUMERIC(9,6)`.
 *
 * @throws {DecimalStrError} ver {@link parseNumeric}.
 */
export function parseRate(s: string): Decimal {
  return parseNumeric(s, LIMITS.rate.precision, LIMITS.rate.scale);
}

/**
 * Valida una calificación, peso o umbral contra `NUMERIC(6,2)`.
 *
 * @throws {DecimalStrError} ver {@link parseNumeric}.
 */
export function parseScore(s: string): Decimal {
  return parseNumeric(s, LIMITS.score.precision, LIMITS.score.scale);
}

/**
 * Serializa un `Decimal` a la forma canónica.
 *
 * Usa `toFixed()` sin argumentos y no `toString()`: decimal.js pasa a notación
 * exponencial en `toString()` a partir de cierto tamaño (`"1e+21"`), lo que
 * rompería a cualquier consumidor del contrato. `toFixed()` nunca lo hace.
 */
export function format(d: Decimal): string {
  const s = d.toFixed();
  // decimal.js conserva el signo del cero; "-0" no es canónico.
  return s === '-0' ? '0' : s;
}

/**
 * Serializa con exactamente `scale` decimales, rellenando con ceros.
 *
 * @throws {DecimalStrError} con code `scale` si el valor tiene MÁS decimales
 * significativos que `scale`: redondear en la capa de serialización esconde una
 * pérdida de precisión que el llamador no pidió. Para redondear hay que hacerlo
 * explícito con {@link roundHalfEven}.
 */
export function formatFixed(d: Decimal, scale: DigitCount): string {
  const got = significantScale(format(d));
  if (got > scale) {
    throw new DecimalStrError(
      'scale',
      `decimal-str: el valor tiene ${got} decimales, se pidieron ${scale}; usar roundHalfEven`,
    );
  }
  return d.toFixed(scale);
}

/**
 * Redondea a `scale` decimales con redondeo bancario (half-even), el único modo
 * permitido para conversiones y cálculos monetarios (research D-14).
 *
 * Es explícito a propósito: ninguna otra función de este módulo redondea.
 */
export function roundHalfEven(d: Decimal, scale: DigitCount): Decimal {
  return d.toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
}

/**
 * Cuenta los decimales de una representación canónica ignorando los ceros
 * finales.
 *
 * Se calcula sobre la cadena y no sobre el `Decimal` porque lo que interesa es
 * la precisión que el emisor declaró, antes de cualquier normalización.
 */
function significantScale(s: string): DigitCount {
  const dot = s.indexOf('.');
  if (dot < 0) {
    return 0;
  }
  return s.slice(dot + 1).replace(/0+$/, '').length;
}
