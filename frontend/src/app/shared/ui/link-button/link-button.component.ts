import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ButtonSize, ButtonVariant } from '../button/button.component';

/** Destino de navegación: la misma forma que acepta `routerLink`. */
export type LinkButtonTarget = string | (string | number)[];

/**
 * FintCart LinkButton — un enlace con el aspecto del botón primario (FR-095, FR-102).
 *
 * POR QUÉ ES UN COMPONENTE APARTE Y NO UN MODO DE `fc-button`: el elemento decide el
 * rol. Un `<a>` se anuncia como enlace, se abre en una pestaña nueva con el menú
 * contextual, y el teclado lo trata como tal; un `<button>` no. Ponerle `role="link"` a
 * un botón —o al revés— es mentirle al lector de pantalla para ahorrar un componente.
 *
 * POR QUÉ NO PUEDE SER UN `@if` DENTRO DE `fc-button`: Angular no proyecta
 * `<ng-content>` dentro de un bloque `@if`/`@else`, así que la rama del enlace
 * renderizaba un `<a>` VACÍO. Lo destapó una prueba que afirma el texto proyectado.
 *
 * Comparte la hoja de estilos de `fc-button` en lugar de duplicarla: los dos tienen que
 * verse idénticos, y dos copias del mismo CSS acaban divergiendo.
 *
 * No admite `disabled`: un enlace deshabilitado no existe en HTML. Si hace falta
 * deshabilitar la acción, la pantalla usa `fc-button`.
 */
@Component({
  selector: 'fc-link-button',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="fc-btn"
      [class.fc-btn--block]="block()"
      [attr.data-variant]="variant()"
      [attr.data-size]="size()"
      [routerLink]="to()"
    >
      <ng-content select="[fcIconLeft]" />
      <ng-content />
      <ng-content select="[fcIconRight]" />
    </a>
  `,
  styleUrl: '../button/button.component.css',
})
export class LinkButtonComponent {
  /** Destino obligatorio: un enlace sin destino no es un enlace. */
  readonly to = input.required<LinkButtonTarget>();
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly block = input(false);
}
