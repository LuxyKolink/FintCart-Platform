import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AuthService } from '../../../core/auth/auth.service';
import {
  BadgeComponent,
  BannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  SkeletonComponent,
  TagComponent,
} from '../../../shared/ui';
import { calculatorTitle } from '../calculator-title';
import { CalculatorError, CalculatorsApiService } from '../calculators-api.service';
import {
  Calculator,
  calculatorStateHelp,
  calculatorStateLabel,
  calculatorStateTone,
  canBeSubmitted,
} from '../calculator.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * «Mis calculadoras»: las propias con su estado de curaduría (T118, FR-051…FR-054).
 *
 * ## Para qué es esta pantalla
 *
 * Una calculadora se crea privada, y para que llegue al catálogo o a un artículo tiene que
 * pasar por curaduría (FR-052). Esta pantalla es el lado del AUTOR de ese trámite: dice en qué
 * estado está cada una, **le enseña el motivo si se la rechazaron** —FR-054 exige comunicárselo,
 * y el motivo vive en la ficha porque el correo no es el sitio de un dato que hay que releer al
 * corregir— y le deja volver a proponerla cuando la haya arreglado.
 *
 * ## Lo que esta pantalla NO hace, y por qué se dice aquí
 *
 * No CREA ni EDITA calculadoras: eso es el constructor visual, que es la tarea T097 y no está.
 * Por eso el estado vacío no promete un formulario: dice lo que hay. Sin esa distinción, la
 * pantalla ofrecería un botón que no lleva a ninguna parte, y «crear una calculadora» es
 * justamente lo que el constructor hará.
 *
 * ## Las reglas no se duplican
 *
 * `canBeSubmitted` decide si se OFRECE el botón, y no es la regla: el Simulador rechaza una
 * propuesta sin nada que proponer con su propio mensaje, y esa respuesta se le enseña al autor
 * tal cual. Duplicar aquí la comprobación —comparando `version` con algo— exigiría un dato que
 * el contrato no manda y que se desincronizaría al primer cambio.
 */
@Component({
  selector: 'fc-my-calculators',
  standalone: true,
  imports: [
    BadgeComponent,
    BannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LinkButtonComponent,
    SkeletonComponent,
    TagComponent,
  ],
  templateUrl: './mine.component.html',
  styles: `
    :host {
      display: block;
      /* Medida de contenido (brief §4): la página dejaba el lead a la izquierda y el estado
         vacío centrado en otro contenedor, así que la pantalla tenía dos ejes de alineación. */
      max-width: var(--content-max);
    }

    .fc-mine__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      align-items: flex-start;
    }

    /* h1 de página: escalón display del brief §3 (38 / 1.15 / 500 / -0.02em). */
    .fc-mine__title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-display);
      line-height: var(--lh-display);
      font-weight: var(--fw-display);
      letter-spacing: var(--ls-display);
      color: var(--text-strong);
      overflow-wrap: anywhere;
    }

    .fc-mine__intro {
      margin: 0;
      max-width: var(--reading-max);
      font-size: var(--fs-ui);
      color: var(--text-body);
    }

    .fc-mine__acciones {
      display: flex;
      gap: var(--space-2) var(--space-4);
      flex-wrap: wrap;
      margin-top: var(--space-2);
    }

    /* Filas separadas por reglas de 1 px: una ficha por calculadora no necesita caja
       (brief §5, §6.7), y el borde + radio anterior competía con las reglas de la tabla. */
    .fc-mine__lista {
      display: flex;
      flex-direction: column;
      margin-top: var(--space-6);
      border-top: var(--border-hairline) solid var(--fc-line);
    }

    .fc-mine__item {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-5) 0;
    }

    .fc-mine__item + .fc-mine__item {
      border-top: var(--border-hairline) solid var(--fc-line);
    }

    .fc-mine__cabecera {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
      flex-wrap: wrap;
    }

    /* Título de bloque: escalón h3 del brief §3 (19 / 1.35 / 600). */
    .fc-mine__nombre {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-h3);
      line-height: var(--lh-h3);
      font-weight: var(--fw-h3);
      letter-spacing: var(--ls-h3);
      color: var(--text-strong);
    }

    .fc-mine__cuerpo {
      display: flex;
      gap: var(--space-3);
      flex-wrap: wrap;
      align-items: baseline;
      margin: 0;
      color: var(--text-muted);
      font-size: var(--fs-meta);
    }
    .fc-mine__indicadores {
      font-family: var(--font-mono);
    }
  `,
})
export class MyCalculatorsComponent implements OnInit {
  private readonly api = inject(CalculatorsApiService);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<Calculator[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** `calculator_id` cuya propuesta está en vuelo. */
  protected readonly submitting = signal<string | null>(null);

  protected readonly userName = this.auth.userId;

  /** Las que esperan revisión, para el resumen de arriba. */
  protected readonly enRevision = computed(() => this.items().filter((c) => c.state === 'en_revision').length);
  protected readonly conRechazo = computed(() =>
    this.items().filter((c) => (c.rejection_reason ?? '') !== ''),
  );

  public ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  protected label(state: string): string {
    return calculatorStateLabel(state);
  }

  protected tone(state: string): ReturnType<typeof calculatorStateTone> {
    return calculatorStateTone(state);
  }

  protected help(state: string): string {
    return calculatorStateHelp(state);
  }

  /** El nombre legible: el de la semilla es un identificador, no un título. */
  protected title(calculator: Calculator): string {
    return calculatorTitle(calculator.name);
  }

  protected canSubmit(calculator: Calculator): boolean {
    return canBeSubmitted(calculator);
  }

  /**
   * Si se ofrece el enlace al constructor.
   *
   * No es una regla de negocio —el Simulador rechazaría una edición de una semilla con su propio
   * mensaje— sino no ofrecer un enlace que lleva a una pantalla que va a decir que no. La semilla
   * es el único caso: no tiene autor, así que no hay nada que editar de ella.
   */
  protected canEdit(calculator: Calculator): boolean {
    return !calculator.is_builtin;
  }

  protected isSubmitting(calculator: Calculator): boolean {
    return this.submitting() === calculator.calculator_id;
  }

  protected onSubmit(calculator: Calculator): void {
    if (this.submitting() !== null) {
      return;
    }
    this.submitting.set(calculator.calculator_id);
    this.errorMessage.set(null);
    this.notice.set(null);

    this.api.submitForReview(calculator.calculator_id).subscribe({
      next: () => {
        this.submitting.set(null);
        this.notice.set(
          `«${calculatorTitle(calculator.name)}» quedó propuesta: un coordinador editorial la revisará.`,
        );
        // Se actualiza en memoria en vez de recargar la lista: el cambio es exactamente este y
        // una recarga completa perdería el aviso que se acaba de dar.
        this.items.set(
          this.items().map((item) =>
            item.calculator_id === calculator.calculator_id
              ? { ...item, state: 'en_revision' as const, rejection_reason: '' }
              : item,
          ),
        );
      },
      error: (err: unknown) => {
        this.submitting.set(null);
        this.errorMessage.set(
          err instanceof CalculatorError ? err.message : 'No pudimos proponer la calculadora.',
        );
      },
    });
  }

  private load(): void {
    this.state.set('loading');
    this.errorMessage.set(null);
    this.api.listMine().subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
