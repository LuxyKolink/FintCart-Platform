import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import {
  BadgeComponent,
  BannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  InputComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  SkeletonComponent,
  TagComponent,
} from '../../../shared/ui';
import { CalculatorError, CalculatorsApiService } from '../../calculators/calculators-api.service';
import { Calculator } from '../../calculators/calculator.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Bandeja de curaduría de calculadoras (T117, FR-052…FR-054).
 *
 * Lista las calculadoras que esperan revisión de CUALQUIER autor y ofrece la decisión:
 * aprobar (pasa al catálogo público y queda auditado) o rechazar con un motivo obligatorio —
 * el motivo es lo que el autor necesita para corregir, y sin él el rechazo lo deja adivinando—.
 *
 * ## La separación de autoría no se decide aquí
 *
 * Que nadie apruebe su propia calculadora (FR-053) lo imponen el Simulador y la base, y esta
 * pantalla NO lo comprueba para ofrecer el botón: **el desenlace se explica cuando el borde lo
 * rechaza** (403), porque decidirlo aquí exigiría comparar el autor con el usuario de la sesión
 * —un dato que esta pantalla tiene, pero cuya comprobación no es suya— y una comprobación en el
 * cliente es una comprobación que se puede saltar. Lo que sí se hace es **señalar** cuáles son
 * tuyas (`authorOf`), que es información y no una barrera.
 *
 * ## Por qué el motivo va en un formulario por fila y no en un diálogo
 *
 * Un rechazo sin motivo no existe (el Simulador lo rechaza con un `CHECK` por debajo), así que
 * el campo tiene que estar delante antes de pulsar. Un diálogo modal añadiría un estado de
 * interfaz que se puede perder —cerrar sin querer y perder el motivo escrito— y una pantalla
 * más que mantener.
 */
@Component({
  selector: 'fc-review-calculators',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    BadgeComponent,
    BannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    InputComponent,
    LinkButtonComponent,
    ModuleBoxComponent,
    SkeletonComponent,
    TagComponent,
  ],
  templateUrl: './review-calculators.component.html',
  styles: `
    :host {
      display: block;
    }
    .fc-revc__intro {
      max-width: 68ch;
      color: var(--text-body);
    }
    .fc-revc__lista {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-top: var(--space-4);
    }
    .fc-revc__item {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .fc-revc__cabecera {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fc-revc__nombre {
      margin: 0;
      font-size: var(--fs-md);
      font-weight: var(--fw-semibold);
    }
    .fc-revc__cuerpo {
      display: flex;
      gap: var(--space-3);
      flex-wrap: wrap;
      align-items: baseline;
      color: var(--text-faint);
      font-size: var(--fs-sm);
    }
    .fc-revc__indicadores {
      font-family: var(--font-mono);
    }
    .fc-revc__salidas {
      margin: 0;
      padding-left: var(--space-4);
      color: var(--text-body);
    }
    .fc-revc__acciones {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fc-revc__rechazo {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding-top: var(--space-2);
      border-top: 1px solid var(--border-subtle);
    }
  `,
})
export class ReviewCalculatorsComponent implements OnInit {
  private readonly api = inject(CalculatorsApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<Calculator[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** `calculator_id` cuya decisión está en vuelo. */
  protected readonly deciding = signal<string | null>(null);
  /** `calculator_id` con el formulario de rechazo abierto. */
  protected readonly rejecting = signal<string | null>(null);
  /** El 403 de FR-053 merece un aviso distinto del error genérico. */
  protected readonly selfApprovalBlocked = signal(false);

  protected readonly reasonError = signal<string | null>(null);

  protected readonly reason = this.fb.nonNullable.control('');

  public ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  protected isBusy(calculator: Calculator): boolean {
    return this.deciding() === calculator.calculator_id;
  }

  protected isMine(calculator: Calculator): boolean {
    return calculator.owner_id !== undefined && calculator.owner_id === this.auth.userId();
  }

  protected isRejecting(calculator: Calculator): boolean {
    return this.rejecting() === calculator.calculator_id;
  }

  protected openReject(calculator: Calculator): void {
    this.rejecting.set(calculator.calculator_id);
    this.reason.reset('');
    this.reasonError.set(null);
  }

  protected cancelReject(): void {
    this.rejecting.set(null);
    this.reasonError.set(null);
  }

  protected onApprove(calculator: Calculator): void {
    this.decide(calculator, () => this.api.approve(calculator.calculator_id), `«${calculator.name}» está publicada.`);
  }

  protected onReject(calculator: Calculator): void {
    const reason = this.reason.value.trim();
    if (reason === '') {
      this.reasonError.set('Escribe el motivo: es lo que el autor leerá para corregir la calculadora.');
      return;
    }
    this.decide(
      calculator,
      () => this.api.reject(calculator.calculator_id, reason),
      `«${calculator.name}» quedó rechazada y su autor verá el motivo.`,
    );
  }

  /**
   * Ejecuta una decisión y, si sale bien, saca la calculadora de la bandeja.
   *
   * Se quita de la lista en lugar de recargar: el cambio es exactamente ese —salió de
   * `en_revision`— y una recarga completa perdería el aviso que se acaba de dar.
   */
  private decide(
    calculator: Calculator,
    request: () => Observable<unknown>,
    okMessage: string,
  ): void {
    if (this.deciding() !== null) {
      return;
    }
    this.deciding.set(calculator.calculator_id);
    this.errorMessage.set(null);
    this.notice.set(null);
    this.selfApprovalBlocked.set(false);
    this.reasonError.set(null);

    request().subscribe({
      next: () => {
        this.deciding.set(null);
        this.rejecting.set(null);
        this.notice.set(okMessage);
        this.items.set(this.items().filter((item) => item.calculator_id !== calculator.calculator_id));
      },
      error: (err: unknown) => {
        this.deciding.set(null);
        if (err instanceof CalculatorError && err.kind === 'forbidden') {
          this.selfApprovalBlocked.set(true);
        }
        this.errorMessage.set(
          err instanceof CalculatorError ? err.message : 'No pudimos completar la revisión.',
        );
      },
    });
  }

  private load(): void {
    this.state.set('loading');
    this.errorMessage.set(null);
    this.api.listForReview().subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
