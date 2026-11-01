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
    /*
     * La marca nunca se deforma ni arrastra el interlineado del texto que la
     * rodea: 'line-height: 0' y 'display: block' son lo que impide que el panel
     * de acceso gane 4 px fantasma bajo el logotipo.
     *
     * No se declara color: el asset lo decide ('currentColor' en
     * fintcart-mark-mono.svg, tintes propios en el resto) y el tratamiento
     * monocromo sobre el acento se aplica desde fc-brand-panel con un filtro.
     */
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
    }
  `,
})
export class BrandLogoComponent {
  readonly variant = input<BrandLogoVariant>('mark');
  readonly width = input(28);
  readonly height = input(28);

  protected readonly src = computed(() => `assets/logo/${FILES[this.variant()]}`);
}
