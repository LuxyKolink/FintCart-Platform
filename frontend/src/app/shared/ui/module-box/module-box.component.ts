import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ModuleBoxAccent = 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/**
 * FintCart ModuleBox — THE signature portal container. A bordered box with a
 * header bar carrying a left accent rule, a title, and optional actions.
 */
@Component({
  selector: 'fc-module-box',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fc-module">
      @if (title()) {
        <header class="fc-module__header" [attr.data-accent]="accent()">
          <ng-content select="[fcIcon]" />
          <h3 class="fc-module__title">{{ title() }}</h3>
          <div class="fc-module__actions">
            <ng-content select="[fcActions]" />
          </div>
        </header>
      }
      <div class="fc-module__body" [class.fc-module__body--padded]="padded()">
        <ng-content />
      </div>
    </section>
  `,
  styleUrl: './module-box.component.css',
})
export class ModuleBoxComponent {
  readonly title = input<string>();
  readonly accent = input<ModuleBoxAccent>('primary');
  readonly padded = input(true);
}
