import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BrandLogoVariant = 'full' | 'inverse' | 'mark' | 'mark-mono' | 'eye';

const FILES: Record<BrandLogoVariant, string> = {
  full: 'fintcart-logo.svg',
  inverse: 'fintcart-logo-inverse.svg',
  mark: 'fintcart-mark.svg',
  'mark-mono': 'fintcart-mark-mono.svg',
  eye: 'fintcart-eye.svg',
};

/**
 * FintCart BrandLogo — the 5 brand SVGs, deduplicated (they lived both in
 * assets/logo/ and styles/assets/logo/; only the Angular-served copy under
 * assets/logo/ remains).
 */
@Component({
  selector: 'fc-brand-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img [src]="src()" [width]="width()" [height]="height()" alt="" />`,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class BrandLogoComponent {
  readonly variant = input<BrandLogoVariant>('mark');
  readonly width = input(28);
  readonly height = input(28);

  protected readonly src = computed(() => `assets/logo/${FILES[this.variant()]}`);
}
