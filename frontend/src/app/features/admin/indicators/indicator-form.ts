import Decimal from 'decimal.js';

/**
 * Reglas del valor de un indicador (T108, FR-056).
 *
 * Son la MISMA regla que aplica el Simulador (`services/simulator/src/domain/decimal_str.rs`
 * y la columna `NUMERIC(20,6)` de `financial_indicators`), escritas aquí para que el
 * administrador lea el motivo antes de enviar en lugar de recibir un «petición inválida»
 * del borde —que es lo que el mapeo genérico de errores devuelve— después de perder el
 * formulario.
 *
 * Duplicar una validación tiene un riesgo conocido: que las dos versiones se separen y la
 * de aquí acepte algo que la de allá rechaza. Se acota de tres formas: la regla es
 * pequeña y está citada, el servidor sigue siendo el que decide (esto es solo el aviso
 * temprano), y `indicator-form.spec.ts` fija los mismos casos límite que
 * `services/simulator/tests/indicators.rs`.
 */

/** Escala de la columna: `NUMERIC(20, 6)`. */
const MAX_DECIMALS = 6;

/** Dígitos enteros admitidos: precisión menos escala. */
const MAX_INTEGER_DIGITS = 20 - MAX_DECIMALS;

/** Límite superior del valor: `|v| < 10^14`. */
const MAX_VALUE = new Decimal(10).pow(MAX_INTEGER_DIGITS);

/**
 * Forma canónica de una cifra decimal, igual que `decimal_str::is_canonical`: dígitos y
 * un punto, sin separador de miles, sin notación científica y sin espacios.
 *
 * Lleva el SIGNO opcional, y no es un descuido: el servidor también lo admite en la
 * forma y rechaza el negativo después, con un mensaje propio. Sin el signo aquí, `-1`
 * caería en el error de sintaxis y el administrador leería «escribe la cifra con
 * dígitos y un punto» sobre un valor que sí tiene la forma correcta — lo que hay que
 * decirle es que un indicador no puede ser negativo.
 */
const CANONICAL = /^-?\d+(\.\d+)?$/u;

/**
 * Valida el valor y devuelve el mensaje de error, o `null` si sirve.
 *
 * El valor se captura como TEXTO y nunca pasa por `number`: `parseFloat` aceptaría
 * `1e3`, `0x10` y `1.5000000000000002`, y en el último caso el redondeo ocurriría antes
 * de que nadie pudiera avisar (Principio VIII).
 */
export function validateIndicatorValue(raw: string): string | null {
  const texto = raw.trim();
  if (texto === '') {
    return 'Escribe el valor del indicador.';
  }
  if (!CANONICAL.test(texto)) {
    return 'Escribe la cifra con dígitos y un punto decimal, sin separador de miles ni notación científica.';
  }

  // A partir de aquí la cifra es canónica, así que `Decimal` no puede fallar; se
  // construye igualmente porque los ceros a la derecha y la escala los resuelve él
  // —`1.500000` cuenta como UN decimal, no como seis—, igual que en el servidor.
  const valor = new Decimal(texto);
  if (valor.isNegative()) {
    return 'Un indicador no puede ser negativo.';
  }
  if (valor.decimalPlaces() > MAX_DECIMALS) {
    return `El valor admite como máximo ${MAX_DECIMALS} decimales.`;
  }
  if (valor.greaterThanOrEqualTo(MAX_VALUE)) {
    return `El valor admite hasta ${MAX_INTEGER_DIGITS} dígitos enteros.`;
  }
  return null;
}

/**
 * La forma que se envía: la cifra sin ceros sobrantes.
 *
 * Se normaliza para que dos vigencias del mismo valor no viajen escritas de dos maneras
 * —`0.050000` y `0.05`— y para que lo que se guarda sea exactamente lo que se ve.
 */
export function normalizeIndicatorValue(raw: string): string {
  return new Decimal(raw.trim()).toString();
}

/**
 * Valida la vigencia `[inicio, fin)` y devuelve el mensaje de error, o `null`.
 *
 * El fin es EXCLUSIVO —así lo impone `financial_indicators_validity_half_open` y lo
 * explica la convención de `[inicio, fin)` de `data-model.md`—, así que empezar y
 * terminar el mismo día no cubre ningún día. Sin esta comprobación el formulario
 * enviaría una vigencia vacía y el error que volvería hablaría de un rango.
 */
export function validateValidity(from: string, to: string): string | null {
  if (from.trim() === '' || to.trim() === '') {
    return 'Indica el primer día de vigencia y el primero en que deja de aplicarse.';
  }
  // Las fechas ISO se comparan como texto sin ambigüedad, y así no hace falta
  // convertirlas a `Date` — que interpretaría el valor como UTC medianoche y podría
  // correrse un día según la zona del navegador.
  if (from.trim() >= to.trim()) {
    return 'La vigencia no cubriría ningún día: el último día indicado es exclusivo.';
  }
  return null;
}

/** El nombre de un indicador, con la forma que exige el `CHECK` de la tabla. */
const INDICATOR_NAME = /^[A-Z][A-Z0-9_]*$/u;

export function validateIndicatorName(raw: string): string | null {
  const nombre = raw.trim();
  if (nombre === '') {
    return 'Escribe o elige el nombre del indicador.';
  }
  if (!INDICATOR_NAME.test(nombre)) {
    return 'El nombre va en MAYÚSCULAS, empieza por letra y solo lleva letras, dígitos o guion bajo (por ejemplo UVT): así lo referencian las fórmulas como @UVT.';
  }
  return null;
}

/**
 * Fecha de fin para mostrar.
 *
 * El contrato no puede expresar «sin fecha de fin» —`valid_to` es una fecha ISO y una
 * vigencia abierta se manda como cadena vacía—, así que la pantalla lo dice con
 * palabras. Mostrar `—` o `2099-12-31` haría creer que hay una fecha.
 */
export function describeValidTo(validTo: string): string {
  return validTo.trim() === '' ? 'sin fecha de fin' : validTo;
}

/** La fecha de hoy en ISO, para marcar la vigencia que aplica ahora. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ¿Está la vigencia en curso hoy? El fin es exclusivo, de ahí el `<`. */
export function coversToday(validFrom: string, validTo: string, today: string): boolean {
  const dentroDelInicio = validFrom <= today;
  const antesDelFin = validTo.trim() === '' || today < validTo;
  return dentroDelInicio && antesDelFin;
}
