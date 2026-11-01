import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Renderer2,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';

export type ProgressBarSize = 'sm' | 'md' | 'lg';
export type ProgressBarTone = 'accent' | 'primary' | 'success' | 'warning' | 'danger';

/**
 * FintCart ProgressBar — the platform's core progress motif ("puntos de progreso").
 * `value`/`max` are display-only counters (question counts, percentages already
 * computed server-side); they are never used to derive a monetary or graded amount.
 *
 * ACCESIBLE NAME. `role="progressbar"` sin nombre se anuncia como «barra de
 * progreso» y nada más: el lector de pantalla no puede decir de qué progreso
 * habla (Lighthouse: `aria-progressbar-name`). El nombre sale de `ariaLabel` o,
 * si no se pasa, del `label` visible —que es el texto que la persona ya lee al
 * lado—. Los dos caminos escriben el mismo `aria-label` del riel, así que un
 * consumidor que ya rotula la barra no necesita añadir nada.
 *
 * The fill width is a continuous 0-100 value with no natural class boundary, so it
 * is set imperatively via Renderer2 (not a template `[style]` binding) to keep the
 * template itself free of inline styles.
 */
@Component({
  selector: 'fc-progress-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fc-progress">
      @if (label() || showValue()) {
        <div class="fc-progress__meta">
          @if (label()) {
            <span class="fc-progress__label">{{ label() }}</span>
          }
          @if (showValue()) {
            <span class="fc-num fc-progress__value">{{ value() }}/{{ max() }}</span>
          }
        </div>
      }
      <div
        class="fc-progress__track"
        [attr.data-size]="size()"
        role="progressbar"
        [attr.aria-label]="accessibleName()"
        [attr.aria-valuenow]="value()"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="max()"
      >
        <div #fill class="fc-progress__fill" [attr.data-tone]="tone()"></div>
      </div>
    </div>
  `,
  styleUrl: './progress-bar.component.css',
})
export class ProgressBarComponent {
  readonly value = input(0);
  readonly max = input(100);
  readonly label = input<string>();
  /**
   * Nombre accesible cuando NO hay `label` visible. El texto tiene que ser el que
   * una persona reconocería al oírlo («Avance hacia el siguiente hito»), no el
   * nombre interno del campo.
   */
  readonly ariaLabel = input<string>();
  readonly showValue = input(false);
  readonly tone = input<ProgressBarTone>('accent');
  readonly size = input<ProgressBarSize>('md');

  protected readonly accessibleName = computed(() => this.ariaLabel() ?? this.label() ?? null);

  protected readonly percent = computed(() => Math.max(0, Math.min(100, (this.value() / this.max()) * 100)));

  private readonly fill = viewChild<ElementRef<HTMLElement>>('fill');
  private readonly renderer = inject(Renderer2);

  constructor() {
    effect(() => {
      const element = this.fill()?.nativeElement;
      if (element) {
        this.renderer.setStyle(element, 'width', `${this.percent()}%`);
      }
    });
  }
}
