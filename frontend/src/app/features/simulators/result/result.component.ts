import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ResultFieldConfig } from '../calculators.config';
import * as resultFormat from '../result-format';

/**
 * Presentación de un resultado de simulación (T046, T126) — puramente de vista: recibe la
 * configuración de campos y el `map<string, string>` decimal tal como llega del borde, y
 * solo formatea para mostrar. **Nunca convierte a `number`** (Principio VIII): el agrupado
 * de miles se hace con una expresión regular sobre la parte entera ya canónica, porque un
 * monto puede exceder `Number.MAX_SAFE_INTEGER` sin dejar de ser un `NUMERIC(19,2)` válido.
 *
 * TODO LO QUE SE IMPRIME PASA POR `formatMoney` / `formatRate` (`shared/format-money.ts`):
 * el `kind` que `calculators.config.ts` declara por campo decide cuál. Sin eso, una cifra
 * salía sin el signo del peso —`17.223.060,60`, que a un lector no le dice que son pesos— y
 * una tasa salía como fracción con ceros de relleno (`0,010000`) en vez de `1 %`. Una cifra
 * sin unidad o con la unidad equivocada es una cifra falsa, no un detalle de formato.
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
    try {
      switch (field.kind) {
        case 'money':
          return resultFormat.formatMoney(raw);
        case 'rate':
          return resultFormat.formatRate(raw);
        default:
          return raw;
      }
    } catch {
      // Un valor que no cumple el formato canónico del contrato se muestra TAL CUAL en
      // lugar de romper la pantalla: enseñar la cadena cruda es no formatear, mientras que
      // caerse aquí dejaría al usuario sin resultado y sin saber qué pasó.
      return raw;
    }
  }
}
