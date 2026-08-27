import { ChangeDetectionStrategy, Component, EventEmitter, Output, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** FintCart Button — primary action control, ported from design/components/forms/Button.jsx. */
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
