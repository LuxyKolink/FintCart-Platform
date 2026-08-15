import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import * as decimalStr from '../../shared/decimal-str';

/**
 * Validador de `pass_threshold`/`weight` (`NUMERIC(6,2)`, Principio VIII). Mismo
 * mecanismo que `features/simulators/decimal-validators.ts`: solo retroalimentación
 * inmediata, porque el borde devuelve un `bad_request` genérico y sin detalle para
 * cualquier `InvalidArgument` (`mapping.go::httpFromGRPC`) — Aprendizaje es quien de
 * verdad valida.
 */
export function scoreValidator(options: { required?: boolean } = {}): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: unknown = control.value;
    if (value === null || value === undefined || value === '') {
      return options.required === true ? { required: true } : null;
    }
    try {
      const parsed = decimalStr.parseScore(String(value));
      return parsed.isNegative() ? { negative: true } : null;
    } catch {
      return { decimalFormat: true };
    }
  };
}
