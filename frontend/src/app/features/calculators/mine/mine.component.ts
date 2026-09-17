import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AuthService } from '../../../core/auth/auth.service';
import {
  BadgeComponent,
  BannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  SkeletonComponent,
  TagComponent,
} from '../../../shared/ui';
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
    ModuleBoxComponent,
    SkeletonComponent,
    TagComponent,
  ],
  templateUrl: './mine.component.html',
  styles: `
    :host {
      display: block;
    }
    .fc-mine__intro {
      max-width: 68ch;
      color: var(--text-body);
    }
    .fc-mine__lista {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-top: var(--space-4);
    }
    .fc-mine__item {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .fc-mine__cabecera {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fc-mine__nombre {
      margin: 0;
      font-size: var(--fs-md);
      font-weight: var(--fw-semibold);
    }
    .fc-mine__cuerpo {
      display: flex;
      gap: var(--space-3);
      flex-wrap: wrap;
      align-items: baseline;
      color: var(--text-faint);
      font-size: var(--fs-sm);
    }
    .fc-mine__indicadores {
      font-family: var(--font-mono);
    }
    .fc-mine__acciones {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
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
        this.notice.set(`«${calculator.name}» quedó propuesta: un coordinador editorial la revisará.`);
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
