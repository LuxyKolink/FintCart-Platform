import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export type AvatarTone = 'primary' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** FintCart Avatar — user monogram or image. */
@Component({
  selector: 'fc-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="fc-avatar" [attr.data-size]="size()" [attr.data-tone]="tone()" [class.fc-avatar--image]="src()">
      @if (src()) {
        <img [src]="src()" [alt]="name()" class="fc-avatar__img" />
      } @else {
        {{ initials() }}
      }
    </span>
  `,
  styleUrl: './avatar.component.css',
})
export class AvatarComponent {
  readonly name = input('');
  readonly src = input<string>();
  readonly size = input<AvatarSize>('md');
  readonly tone = input<AvatarTone>('primary');

  protected readonly initials = computed(() => {
    const parts = this.name()
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]);
    return parts.length ? parts.join('').toUpperCase() : '·';
  });
}
