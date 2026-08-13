import { Component, computed, input } from '@angular/core';

import { ResultFieldConfig } from '../calculators.config';
import * as resultFormat from '../result-format';

/**
 * Presentación de un resultado de simulación (T126) — puramente de vista: recibe la
 * configuración de campos y el `map<string, string>` decimal tal como llega del borde,
 * y solo formatea para mostrar. Nunca convierte a `number` (Principio VIII).
 */
@Component({
  selector: 'fc-simulation-result',
  standalone: true,
  templateUrl: './result.component.html',
})
export class ResultComponent {
  public readonly fields = input.required<ResultFieldConfig[]>();
  public readonly result = input.required<Record<string, string>>();

  protected readonly rows = computed(() =>
    this.fields()
      .filter((field) => field.optional !== true || this.result()[field.key] !== undefined)
      .map((field) => ({ label: field.label, value: this.formatted(field) })),
  );

  private formatted(field: ResultFieldConfig): string {
    const raw = this.result()[field.key];
    if (raw === undefined) {
      return '—';
    }
    switch (field.kind) {
      case 'money':
        return resultFormat.formatMoney(raw);
      case 'rate':
        return resultFormat.formatRate(raw);
      default:
        return raw;
    }
  }
}
