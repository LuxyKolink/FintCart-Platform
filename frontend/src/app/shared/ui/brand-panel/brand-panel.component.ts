import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { BrandLogoComponent } from '../brand-logo/brand-logo.component';
import { IconComponent, type IconName } from '../icon/icon.component';

/** Un dato de "qué hay dentro" que el panel de marca anuncia junto al formulario. */
export interface BrandIndicator {
  readonly icon: IconName;
  readonly label: string;
}

/**
 * Indicadores por defecto — CUALITATIVOS a propósito.
 *
 * El kit (`design/ui_kits/auth/app.js`) escribe «+120 artículos» y «5
 * simuladores». Ninguna de las dos cifras es cierta: la semilla deja 5 artículos
 * publicados y 7 calculadoras. Un número inventado en la portada no es texto
 * incompleto, es un dato falso — el mismo criterio con el que N-15 trata una
 * cifra truncada. Se declara lo que hay sin cuantificarlo; si más adelante se
 * quiere el número real, entra por el input `indicators` desde una pantalla que
 * sí pueda consultarlo (FR-122: la carencia se reporta, no se resuelve aquí).
 *
 * El icono del tercer indicador es `flame` y no el `award` del kit porque
 * `award` no pertenece a los 25 iconos registrados (research D-32): añadirlo
 * metería un icono nuevo a la biblioteca por un adorno de portada.
 */
const DEFAULT_INDICATORS: readonly BrandIndicator[] = [
  { icon: 'book-open', label: 'Artículos del contexto colombiano' },
  { icon: 'calculator', label: 'Simuladores financieros' },
  { icon: 'flame', label: 'Mide tu progreso' },
];

/**
 * FintCart BrandPanel — la mitad de marca del card de acceso: logotipo, titular,
 * subtítulo y los indicadores de contenido (FR-087, FR-098).
 *
 * POR QUÉ ES COMPARTIDO Y NO DE CADA PANTALLA: las tres pantallas de acceso
 * (login, registro, verificación) muestran el mismo panel. Repetirlo tres veces
 * habría creado tres copias de la identidad de marca que divergen a la primera
 * corrección — exactamente lo que FR-087 prohíbe.
 *
 * POR QUÉ EL FONDO LLEVA `background-color` ADEMÁS DEL DEGRADADO: el contraste
 * medido del texto blanco se calcula contra el color de fondo COMPUTADO, y el
 * de un elemento con solo `background-image` es transparente: el verificador
 * subiría hasta el blanco de la tarjeta y daría un falso positivo. Un fondo
 * sólido debajo del degradado fija el peor caso real (5.11:1 en el coral 500) y
 * además cubre el caso de que el degradado no se pinte.
 */
@Component({
  selector: 'fc-brand-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandLogoComponent, IconComponent],
  templateUrl: './brand-panel.component.html',
  styleUrl: './brand-panel.component.css',
})
export class BrandPanelComponent {
  readonly title = input('Aprende a manejar tu plata, paso a paso.');
  readonly subtitle = input(
    'Artículos, cuestionarios y simuladores financieros pensados para el contexto colombiano. Gratis.',
  );
  readonly indicators = input<readonly BrandIndicator[]>(DEFAULT_INDICATORS);
}
