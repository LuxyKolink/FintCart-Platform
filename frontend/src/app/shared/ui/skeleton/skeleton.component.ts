import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Renderer2,
  RendererStyleFlags2,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';

export type SkeletonVariant = 'text' | 'title' | 'circle' | 'rect';

/**
 * FintCart Skeleton — estado de carga con la forma del contenido que va a
 * aparecer (research D-32, FR-118).
 *
 * POR QUÉ EXISTE: los cinco kits se dibujaron con datos siempre presentes, así
 * que no hay en ellos ni una pantalla con carga. Resolver el estado de carga
 * pantalla a pantalla produciría diecinueve versiones del mismo marcador; vive
 * en la biblioteca compartida (FR-087).
 *
 * ACCESIBILIDAD: las barras son geometría decorativa (`aria-hidden`), pero el
 * contenedor es un `role="status"` con una etiqueta viva, porque un lector de
 * pantalla no puede leer una caja gris: sin esto, la pantalla que carga sería
 * indistinguible del silencio. El `label` es configurable y se puede anular
 * (`[label]="null"`) cuando el contenedor de la página ya anuncia la carga y no
 * se quiere repetir el aviso por cada marcador.
 *
 * POR QUÉ LAS DIMENSIONES NO SON UN `[style]` DE PLANTILLA: una dimensión que
 * depende del dato no tiene frontera de clase que la exprese, pero
 * `no-inline-styles` prohíbe el atributo `style` en la plantilla y el script
 * `design-debt.mjs` lo cuenta. Se fijan imperativamente en las propiedades
 * personalizadas del contenedor, igual que `ProgressBar` fija el ancho de su
 * relleno — la plantilla queda limpia y la hoja de estilos sigue mandando.
 */
@Component({
  selector: 'fc-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #root
      class="fc-skeleton"
      role="status"
      [attr.data-variant]="variant()"
      [attr.aria-label]="label()"
    >
      @for (bar of bars(); track bar) {
        <span class="fc-skeleton__bar" aria-hidden="true"></span>
      }
    </div>
  `,
  styleUrl: './skeleton.component.css',
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('text');
  /** Número de líneas. `circle` y `rect` siempre son una sola pieza. */
  readonly lines = input(1);
  readonly width = input('100%');
  /** Alto explícito. Si es nulo, cada variante usa el suyo. */
  readonly height = input<string | null>(null);
  readonly label = input<string | null>('Cargando…');

  protected readonly bars = computed<number[]>(() => {
    const shape = this.variant();
    const requested = Math.floor(this.lines());
    const count = shape === 'circle' || shape === 'rect' ? 1 : Math.max(1, requested || 1);
    return Array.from({ length: count }, (_, index) => index);
  });

  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly renderer = inject(Renderer2);

  constructor() {
    effect(() => {
      const element = this.root()?.nativeElement;
      if (!element) {
        return;
      }
      this.setVariable(element, '--fc-skeleton-w', this.width());

      const height = this.height();
      if (height === null) {
        this.renderer.removeStyle(element, '--fc-skeleton-h', RendererStyleFlags2.DashCase);
      } else {
        this.setVariable(element, '--fc-skeleton-h', height);
      }
    });
  }

  private setVariable(element: HTMLElement, name: string, value: string): void {
    this.renderer.setStyle(element, name, value, RendererStyleFlags2.DashCase);
  }
}
