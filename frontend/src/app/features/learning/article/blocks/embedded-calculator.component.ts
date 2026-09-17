import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';

import { BannerComponent, ErrorStateComponent, SkeletonComponent } from '../../../../shared/ui';
import { CalculatorError, CalculatorsApiService } from '../../../calculators/calculators-api.service';
import type { Calculator } from '../../../calculators/calculator.types';
import { CalculatorRunnerComponent } from '../../../calculators/runner/runner.component';

/** Los cuatro estados posibles de un bloque incrustado. */
type BlockState = 'loading' | 'ready' | 'unpublished' | 'error';

/**
 * La calculadora incrustada en un artículo, ejecutable por quien lee (T153–T155, FR-071/FR-072).
 *
 * ## Por qué pasa por el Gateway y no calcula aquí
 *
 * Es la decisión de D-25 y no una preferencia: la ejecución de una calculadora incrustada recorre
 * **la misma ruta** que cualquier simulación —borde → Orquestador → Simulador— para que quede en
 * el historial de quien la ejecutó (FR-071) y en la auditoría (FR-025). Una ruta «ligera» desde el
 * artículo dejaría esas ejecuciones fuera de las dos. El componente no calcula nada: pide la
 * definición, la pinta y manda los valores, igual que la pantalla del simulador. El número lo
 * calcula el Simulador con `rust_decimal`, y los valores viajan como cadenas (Principio VIII).
 *
 * ## FR-072: cuando la calculadora ya no está publicada
 *
 * El artículo **sigue siendo legible**. Este bloque pregunta por la calculadora al montarse y, si
 * la respuesta es «no está publicada» —el Simulador responde lo mismo para «no existe» y para «no
 * la puedes ver», a propósito: no es un oráculo de existencia—, se dibuja un aviso en su lugar.
 * Nada más del artículo se ve afectado: el resto de los bloques se pinta igual.
 *
 * Que esto se resuelva al leer y no al borrar la calculadora es lo que hace que un artículo no
 * dependa de que alguien se acuerde de comprobar sus referencias: la referencia se sanea donde se
 * usa.
 *
 * ## Lo que NO hace
 *
 * No decide si la calculadora está publicada por su cuenta —eso lo dice el Simulador, y para él
 * pregunta el catálogo público—, no toca el documento del artículo (el bloque solo recibe el
 * identificador y la versión que el documento guardó) y no formatea cifras: eso es del ejecutor,
 * que es quien conoce la escala que declaró el autor.
 */
@Component({
  selector: 'fc-embedded-calculator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BannerComponent, ErrorStateComponent, SkeletonComponent, CalculatorRunnerComponent],
  template: `
    @switch (state()) {
      @case ('loading') {
        <!--
          Un hueco con la forma de lo que va a llegar. Un artículo que salta cuando la
          calculadora aparece deja de leerse a media frase.
        -->
        <div class="fc-embedded" role="status" aria-label="Cargando la calculadora">
          <fc-skeleton height="2rem" />
          <fc-skeleton height="5rem" />
        </div>
      }
      @case ('ready') {
        @if (calculator(); as calc) {
          @if (versionCambiada()) {
            <!--
              El artículo fijó una versión al incrustarla y el catálogo sirve otra, porque la
              calculadora se corrigió después. Se ejecuta lo PUBLICADO —una corrección de una
              fórmula equivocada tiene que llegar a todos los artículos— y se dice con cuál se
              calculó, que es lo que hace que la cifra sea comprobable.
            -->
            <fc-banner tone="info">
              Este artículo se escribió con la versión {{ pinnedVersion() }} de la calculadora, y
              se está calculando con la {{ calc.version }}, que es la publicada ahora.
            </fc-banner>
          }
          <fc-calculator-runner [definition]="calc" [embedded]="true" />
        }
      }
      @case ('unpublished') {
        <!--
          El aviso SUSTITUYE al bloque y no rompe la lectura. El texto no dice «error» porque no
          es uno del lector: la calculadora que el artículo usaba ya no está en el catálogo, y
          quien lee no puede hacer nada al respecto —pero sí puede saber por qué no hay bloque—.
        -->
        <fc-banner tone="warning">
          Aquí había una calculadora que ya no está publicada, así que no se puede usar desde este
          artículo. El resto del artículo se lee con normalidad.
        </fc-banner>
      }
      @case ('error') {
        <!--
          Un fallo de red NO es «ya no está publicada»: son dos mensajes distintos porque exigen
          dos acciones distintas, y decirle a quien lee que la calculadora desapareció cuando lo
          que falló fue la conexión es mentirle sobre el contenido del artículo.
        -->
        <fc-error-state
          icon="calculator"
          title="No pudimos cargar la calculadora"
          message="Puede que hayas perdido la conexión. El resto del artículo se lee con normalidad."
          retryLabel="Reintentar"
          (retry)="cargar()"
        />
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin-block: var(--space-4);
    }
    .fc-embedded {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
  `,
})
export class EmbeddedCalculatorComponent {
  private readonly api = inject(CalculatorsApiService);

  /** El identificador que el documento del artículo guardó. */
  public readonly calculatorId = input.required<string>();

  /**
   * La versión que el artículo fijó al incrustarla.
   *
   * Se enseña solo si difiere de la que se ejecuta. Es un dato del documento, no un parámetro de
   * la ejecución: el artículo declara con qué definición se escribió, y el resultado declara con
   * cuál se calculó.
   */
  public readonly pinnedVersion = input<number | null>(null);

  protected readonly state = signal<BlockState>('loading');
  protected readonly calculator = signal<Calculator | null>(null);

  /** `true` si la calculadora se corrigió después de que el artículo la incrustara. */
  protected readonly versionCambiada = computed(() => {
    const calc = this.calculator();
    const fijada = this.pinnedVersion();
    return calc !== null && fijada !== null && calc.version !== fijada;
  });

  public constructor() {
    // Se carga al CREARSE y cada vez que cambie el identificador. Un `ngOnInit` bastaría hoy,
    // porque Angular recrea el componente al cambiar de artículo; el `effect` cubre el caso de
    // reutilizar la vista —que es lo que hace el enrutador con la misma ruta— sin depender de
    // que eso siga siendo cierto.
    effect(() => {
      const id = this.calculatorId();
      this.cargar(id);
    });
  }

  /** Pide la definición y decide el estado a partir de lo que contesta el borde. */
  protected cargar(id: string = this.calculatorId()): void {
    this.state.set('loading');
    this.calculator.set(null);
    this.api.get(id).subscribe({
      next: (calc) => {
        this.calculator.set(calc);
        this.state.set('ready');
      },
      error: (err: unknown) => {
        // `notFound` es la respuesta del Simulador tanto para «no existe» como para «existe y no
        // la puedes ver», y las dos cosas significan lo mismo aquí: el bloque no se puede
        // ejecutar. Cualquier otro fallo es un fallo, y se cuenta como tal.
        this.state.set(err instanceof CalculatorError && err.kind === 'notFound' ? 'unpublished' : 'error');
      },
    });
  }
}
