import { Component } from '@angular/core';

import { CardComponent, IconComponent, LinkButtonComponent } from '../../../shared/ui';
import { CALCULATORS } from '../calculators.config';
import { CalculatorRailComponent } from '../rail/calculator-rail.component';

/**
 * Portada del módulo de simuladores (T044, FR-107).
 *
 * POR QUÉ NO REPITE LA LISTA EN TARJETAS: el kit dibuja el riel **y** el formulario en la
 * misma vista, así que la lista de calculadoras aparece una sola vez. Aquí el formulario
 * vive en su propia ruta, pero la lista se sigue mostrando una sola vez —en el riel— y no
 * dos: `us2-simuladores.spec.ts` selecciona `getByRole('link', { name: 'Crédito' })`, que
 * coincide por subcadena, y dos enlaces con el mismo nombre harían fallar el recorrido por
 * ambigüedad (nota N-13).
 *
 * Esta pantalla no consume datos: las cinco calculadoras salen de `calculators.config.ts`,
 * que es un espejo de los contratos. Por eso no tiene estados de carga ni de error
 * (FR-118 solo obliga a las pantallas que DEPENDEN de datos).
 */
@Component({
  selector: 'fc-simulator-selector',
  standalone: true,
  imports: [CardComponent, IconComponent, LinkButtonComponent, CalculatorRailComponent],
  templateUrl: './selector.component.html',
  styleUrl: './selector.component.css',
})
export class SelectorComponent {
  protected readonly calculators = CALCULATORS;
  protected readonly calculatorCount = CALCULATORS.length;
}
