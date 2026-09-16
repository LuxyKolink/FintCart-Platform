import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { IconComponent, type IconName } from '../icon/icon.component';

/**
 * FintCart EmptyState — ilustración, mensaje y acción sugerida cuando no hay
 * nada que mostrar (research D-32, FR-119).
 *
 * POR QUÉ EXISTE: los kits se dibujaron con datos siempre presentes, así que
 * "el catálogo no tiene artículos publicados", "el progreso no tiene
 * cuestionarios resueltos" o "la bandeja no tiene notificaciones" son estados
 * que ningún kit cubre. La acción sugerida se proyecta (`<ng-content>`) en vez
 * de ser un botón fijo: el vacío del catálogo ofrece "Explorar", el de progreso
 * no ofrece ninguno, y forzar un botón por props obligaría a un componente a
 * saber de rutas.
 *
 * ACCESIBILIDAD: el contenedor es un `role="status"`, de modo que al aparecer
 * tras una carga el lector de pantalla anuncia el mensaje. El icono va sin
 * etiqueta porque es decorativo — el texto es el que informa.
 */
@Component({
  selector: 'fc-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="fc-empty-state" role="status">
      <fc-icon class="fc-empty-state__icon" [name]="icon()" [size]="40" />
      <p class="fc-empty-state__title">{{ title() }}</p>
      @if (message()) {
        <p class="fc-empty-state__message">{{ message() }}</p>
      }
      <div class="fc-empty-state__action">
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './empty-state.component.css',
})
export class EmptyStateComponent {
  readonly icon = input<IconName>('info');
  readonly title = input.required<string>();
  readonly message = input<string | null>(null);
}
