import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ModuleBoxComponent } from '../../../shared/ui';
import { ResultFieldConfig } from '../calculators.config';
import * as resultFormat from '../result-format';

/**
 * Presentación de un resultado de simulación (T046, T126) — puramente de vista: recibe la
 * configuración de campos y el `map<string, string>` decimal tal como llega del borde, y
 * solo formatea para mostrar. **Nunca convierte a `number`** (Principio VIII): el agrupado
 * de miles se hace con una expresión regular sobre la parte entera ya canónica, porque un
 * monto puede exceder `Number.MAX_SAFE_INTEGER` sin dejar de ser un `NUMERIC(19,2)` válido.
 *
 * LA PRIMERA FILA ES LA PRINCIPAL y se pinta más grande. Por eso importa el ORDEN de
 * `resultFields` en `calculators.config.ts`: el campo que resume el cálculo va primero, y
 * `us2-simuladores.spec.ts` comprueba que el primer `dd.fc-num` de la pantalla lleve el
 * símbolo del peso. Invertir el orden no rompería la maquetación: rompería la afirmación.
 *
 * NINGUNA CIFRA SE RECORTA (nota N-15, T049): las filas usan `flex-wrap`, así que una cifra
 * que no cabe **cambia de línea** en lugar de encogerse o recortarse, y no hay
 * `text-overflow` ni `line-clamp` en ninguna regla de dinero. Un importe cortado no es texto
 * incompleto: es otro importe.
 */
@Component({
  selector: 'fc-simulation-result',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModuleBoxComponent],
  templateUrl: './result.component.html',
  styleUrl: './result.component.css',
})
export class ResultComponent {
  public readonly fields = input.required<ResultFieldConfig[]>();
  public readonly result = input.required<Record<string, string>>();
  /** Moneda de las cifras; el borde solo admite `COP` hoy, pero se declara igual. */
  public readonly currency = input('COP');

  protected readonly rows = computed(() =>
    this.fields()
      .filter((field) => field.optional !== true || this.result()[field.key] !== undefined)
      .map((field) => ({ label: field.label, value: this.formatted(field), kind: field.kind })),
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
