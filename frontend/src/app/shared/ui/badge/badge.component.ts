import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeVariant = 'soft' | 'solid';

/** FintCart Badge — small status/label pill, e.g. Borrador / Publicado / Aprobado. */
@Component({
  selector: 'fc-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="fc-badge" [attr.data-tone]="tone()" [attr.data-variant]="variant()">
      <ng-content />
    </span>
  `,
  styleUrl: './badge.component.css',
})
export class BadgeComponent {
  readonly tone = input<BadgeTone>('neutral');
  readonly variant = input<BadgeVariant>('soft');
}
