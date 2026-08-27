import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** FintCart Card — content card for catalog articles & results. */
@Component({
  selector: 'fc-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fc-card" [class.fc-card--interactive]="interactive()" [class.fc-card--padded]="padded()">
      <ng-content />
    </div>
  `,
  styleUrl: './card.component.css',
})
export class CardComponent {
  readonly interactive = input(false);
  readonly padded = input(true);
}
