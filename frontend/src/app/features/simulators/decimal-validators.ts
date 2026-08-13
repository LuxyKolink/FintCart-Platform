import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import Decimal from 'decimal.js';

import * as decimalStr from '../../shared/decimal-str';

/**
 * Validadores de campo para los formularios de simuladores, reusando
 * `shared/decimal-str.ts` (decimal.js) — la MISMA librería decimal que ya usa el resto
 * del frontend (`quiz.component.ts` para `score`). El Simulador (Rust) es quien de
 * verdad valida las reglas de negocio; estos validadores solo dan retroalimentación
 * inmediata, porque el borde devuelve un `bad_request` genérico y sin detalle para
 * cualquier `InvalidArgument` (`mapping.go::httpFromGRPC`) — sin ellos, cualquier
 * parámetro mal formado se vería en el navegador como "petición inválida" a secas.
 */

function emptyIsValid(control: AbstractControl): boolean {
  return control.value === null || control.value === undefined || control.value === '';
}

/** Monto en `NUMERIC(19,2)`. `min` es inclusivo si se indica (p. ej. `'0'` o `'0.01'` vía `strictlyPositive`). */
export function moneyValidator(options: { required?: boolean; strictlyPositive?: boolean } = {}): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (emptyIsValid(control)) {
      return options.required === true ? { required: true } : null;
    }
    try {
      const value = decimalStr.parseMoney(String(control.value));
      if (value.isNegative()) {
        return { negative: true };
      }
      if (options.strictlyPositive === true && value.isZero()) {
        return { mustBePositive: true };
      }
      return null;
    } catch {
      return { decimalFormat: true };
    }
  };
}

/**
 * Tasa en `NUMERIC(9,6)`, expresada como fracción (`"0.12"`, nunca `"12"`).
 *
 * `floorExclusive` fija el límite inferior estricto que comparten casi todas las
 * calculadoras (`> -100 %`, porque una pérdida total o mayor no deja nada que
 * proyectar) — ver `inversion.rs`/`colombia.rs`.
 */
export function rateValidator(
  options: { required?: boolean; floorExclusive?: string; forbidNegative?: boolean } = {},
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (emptyIsValid(control)) {
      return options.required === true ? { required: true } : null;
    }
    try {
      const value = decimalStr.parseRate(String(control.value));
      if (options.forbidNegative === true && value.isNegative()) {
        return { negative: true };
      }
      if (options.floorExclusive !== undefined && value.lte(new Decimal(options.floorExclusive))) {
        return { belowFloor: { floor: options.floorExclusive } };
      }
      return null;
    } catch {
      return { decimalFormat: true };
    }
  };
}

/**
 * Entero positivo de periodos (meses o años), tal como lo exige `Inputs::periods`
 * (máx. 1200, `MAX_PERIODS` en `inputs.rs`). Se compara con `Decimal` y no con
 * `Number()` — este directorio prohíbe el global `Number` (`.eslintrc.json`), la
 * misma regla del Principio VIII que aquí protege un conteo de periodos y no dinero,
 * pero una sola excepción al lint por archivo es más fácil de auditar que una por
 * cada validador.
 */
export function periodsValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (emptyIsValid(control)) {
      return { required: true };
    }
    const raw = String(control.value);
    if (!/^\d+$/u.test(raw)) {
      return { integerFormat: true };
    }
    const value = new Decimal(raw);
    if (value.lessThan(1) || value.greaterThan(1200)) {
      return { periodsRange: true };
    }
    return null;
  };
}
