import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ButtonComponent } from '../button/button.component';
import { IconComponent, type IconName } from '../icon/icon.component';

/**
 * FintCart ErrorState — mensaje comprensible y acción de reintento (research
 * D-32, FR-118).
 *
 * POR QUÉ LA ACCIÓN VA DENTRO: un mensaje de error sin salida deja al usuario
 * atrapado, y "Reintentar" es la única salida que el sistema puede ofrecer sin
 * conocer el contexto de la pantalla. Va con `variant="secondary"` porque el
 * reintento es una recuperación, no la acción principal de la página — la
 * primaria sigue perteneciendo a la pantalla que falló. Se admite contenido
 * proyectado para acciones adicionales (por ejemplo, "volver al catálogo").
 *
 * ACCESIBILIDAD: `role="alert"` (asertivo) y no `status` (cortés), porque un
 * error que no se anuncia puede dejar al usuario esperando una carga que ya
 * terminó. El botón toma su nombre accesible del texto, y el icono es
 * decorativo.
 */
@Component({
  selector: 'fc-error-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent],
  template: `
    <div class="fc-error-state" role="alert">
      <fc-icon class="fc-error-state__icon" [name]="icon()" [size]="40" />
      <p class="fc-error-state__title">{{ title() }}</p>
      @if (message()) {
        <p class="fc-error-state__message">{{ message() }}</p>
      }
      <div class="fc-error-state__action">
        <fc-button variant="secondary" [disabled]="retrying()" (pressed)="retry.emit($event)">
          {{ retryLabel() }}
        </fc-button>
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './error-state.component.css',
})
export class ErrorStateComponent {
  readonly icon = input<IconName>('info');
  readonly title = input('Algo salió mal');
  readonly message = input<string | null>(null);
  readonly retryLabel = input('Reintentar');
  /** Mientras el reintento está en vuelo, el botón se deshabilita. */
  readonly retrying = input(false);
  readonly retry = output<MouseEvent>();
}
