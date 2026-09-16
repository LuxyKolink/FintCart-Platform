import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ModuleBoxComponent } from '../../../shared/ui';
import { CALCULATORS } from '../calculators.config';
import { CalcType } from '../simulators.types';

/**
 * Riel de calculadoras disponibles (T044, FR-107).
 *
 * Vive en su propio componente porque lo usan DOS pantallas —el selector y el formulario—
 * y FR-107 pide que el riel acompañe al formulario de la calculadora elegida. Duplicar la
 * lista en dos plantillas habría dejado dos sitios donde olvidarse de una calculadora nueva.
 *
 * SIN ICONOS, A PROPÓSITO: el riel del kit dibuja uno por calculadora (`wallet`,
 * `trending-up`, `landmark`), y ninguno de los tres está entre los 25 iconos registrados
 * (research D-32). Un icono aproximado —una alcancía para «Inversión»— no es un icono
 * mejor: es otro dato inventado (N-15). Cuando el catálogo de iconos crezca, aquí se
 * añaden.
 *
 * CADA NOMBRE APARECE UNA SOLA VEZ COMO ENLACE EN LA PANTALLA. `us2-simuladores.spec.ts`
 * selecciona `getByRole('link', { name: 'Crédito' })`, que coincide por subcadena: si el
 * selector mostrara además tarjetas con el mismo nombre, el localizador resolvería a dos
 * elementos y el recorrido fallaría por ambigüedad (nota N-13).
 */
@Component({
  selector: 'fc-calculator-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ModuleBoxComponent],
  template: `
    <fc-module-box title="Calculadoras" accent="primary" [padded]="false">
      <nav aria-label="Calculadoras disponibles">
        <ul class="fc-rail__list">
          @for (calculator of calculators; track calculator.calcType) {
            <li>
              <a
                class="fc-rail__link"
                [class.fc-rail__link--active]="calculator.calcType === active()"
                [routerLink]="['/simuladores', calculator.calcType]"
                [attr.aria-current]="calculator.calcType === active() ? 'page' : null"
              >
                {{ calculator.label }}
              </a>
            </li>
          }
        </ul>
      </nav>
    </fc-module-box>
  `,
  styleUrl: './calculator-rail.component.css',
})
export class CalculatorRailComponent {
  /** `calcType` activo, o `null` cuando no hay ninguno seleccionado todavía. */
  readonly active = input<CalcType | null>(null);

  protected readonly calculators = CALCULATORS;
}
