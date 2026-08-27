import { ChangeDetectionStrategy, Component, EventEmitter, Output, input } from '@angular/core';

export type TagCategory = 'ahorro' | 'credito' | 'presupuesto' | 'inversion' | 'colombia' | 'neutral';

/** FintCart Tag — category chip with a colored dot, the catalog's topic filter vocabulary. */
@Component({
  selector: 'fc-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (href()) {
      <a [href]="href()" class="fc-tag" [class.fc-tag--active]="active()" [attr.data-category]="category()">
        <span aria-hidden="true" class="fc-tag__dot"></span>
        <ng-content />
      </a>
    } @else {
      <button
        type="button"
        class="fc-tag"
        [class.fc-tag--active]="active()"
        [attr.data-category]="category()"
        (click)="pressed.emit($event)"
      >
        <span aria-hidden="true" class="fc-tag__dot"></span>
        <ng-content />
      </button>
    }
  `,
  styleUrl: './tag.component.css',
})
export class TagComponent {
  readonly category = input<TagCategory>('neutral');
  readonly href = input<string>();
  readonly active = input(false);

  @Output() readonly pressed = new EventEmitter<MouseEvent>();
}
