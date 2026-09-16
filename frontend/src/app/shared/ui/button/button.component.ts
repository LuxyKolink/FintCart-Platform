import { ChangeDetectionStrategy, Component, EventEmitter, Output, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * FintCart Button — primary action control, ported from design/components/forms/Button.jsx.
 *
 * ACCIÓN, NO NAVEGACIÓN. Si el control lleva a otra pantalla, el componente es
 * `fc-link-button`: un `<a>` y un `<button>` se anuncian distinto, se enfocan distinto y
 * se activan distinto, así que son dos componentes y no uno con un modificador
 * (FR-095). Esta separación no es una preferencia: una versión anterior de este
 * componente intentaba elegir el elemento con `@if`/`@else` dentro de su propia
 * plantilla, y Angular **no proyecta `<ng-content>` dentro de un bloque de control de
 * flujo** —el enlace salía vacío, sin texto—. Se descubrió con una prueba que afirma el
 * texto proyectado, no solo la etiqueta.
 */
@Component({
  selector: 'fc-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type()"
      [disabled]="disabled()"
      class="fc-btn"
      [class.fc-btn--block]="block()"
      [attr.data-variant]="variant()"
      [attr.data-size]="size()"
      (click)="pressed.emit($event)"
    >
      <ng-content select="[fcIconLeft]" />
      <ng-content />
      <ng-content select="[fcIconRight]" />
    </button>
  `,
  styleUrl: './button.component.css',
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly block = input(false);
  readonly disabled = input(false);
  readonly type = input<'button' | 'submit' | 'reset'>('button');

  @Output() readonly pressed = new EventEmitter<MouseEvent>();
}
