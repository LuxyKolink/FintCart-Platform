import { Component } from '@angular/core';

import { IconComponent, LinkButtonComponent } from '../../../shared/ui';
import { CALCULATORS } from '../calculators.config';
import { CalculatorRailComponent } from '../rail/calculator-rail.component';

/**
 * Portada del módulo de simuladores (T044, FR-107) — dirección de arte v2 (brief §4, §8).
 *
 * POR QUÉ NO REPITE LA LISTA EN TARJETAS: el kit dibuja la lista **y** el formulario en la
 * misma vista, así que la lista de calculadoras aparece una sola vez. Aquí el formulario
 * vive en su propia ruta, pero la lista se sigue mostrando una sola vez —en la fila de
 * enlaces de arriba— y no dos: `us2-simuladores.spec.ts` selecciona `getByRole('link',
 * { name: 'Crédito' })`, que coincide por subcadena, y dos enlaces con el mismo nombre harían
 * fallar el recorrido por ambigüedad (nota N-13).
 *
 * Una sola columna a `--content-max`: la portada explicaba el mecanismo en una tarjeta que
 * ocupaba el 1fr de una rejilla con un riel de 230 px a la izquierda, y el resto del ancho
 * quedaba vacío. El brief §4 retira el riel y §6.7 la caja; lo que separa los bloques es una
 * regla de 1 px y el espacio.
 *
 * Esta pantalla no consume datos: las cinco calculadoras salen de `calculators.config.ts`,
 * que es un espejo de los contratos. Por eso no tiene estados de carga ni de error
 * (FR-118 solo obliga a las pantallas que DEPENDEN de datos).
 */
@Component({
  selector: 'fc-simulator-selector',
  standalone: true,
  imports: [IconComponent, LinkButtonComponent, CalculatorRailComponent],
  templateUrl: './selector.component.html',
  styleUrl: './selector.component.css',
})
export class SelectorComponent {
  protected readonly calculators = CALCULATORS;
  protected readonly calculatorCount = CALCULATORS.length;
}
