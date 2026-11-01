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
    /*
     * Curaduría de calculadoras (FR-052…FR-054) — marco en la dirección de arte v2.
     *
     * FILAS, NO TARJETAS. Cada propuesta era una caja con borde de 1 px y radio, apilada
     * con un hueco: cuatro bordes para separar dos propuestas. Brief §8: reglas de 1 px
     * entre filas, sin tarjetas, y una regla superior que despega la lista del bloque de
     * cabecera. La jerarquía la cargan el nombre de la calculadora y el espacio.
     *
     * EL METADATO ES SUBORDINADO. Versión propuesta, autoría e indicadores bajan a 13 px
     * en tinta terciaria: se leen después del nombre y de las salidas, que es lo que se
     * necesita para decidir.
     *
     * SIN MAYÚSCULAS FORZADAS ni barras de acento: no había ninguna, y no vuelven.
     */
    /*
     * EL MARCO. Una columna de --content-max (880 px) y el mismo eje que la bandeja de
     * revisión y el listado de versiones: la pantalla no tenía contenedor y cada bloque se
     * estiraba hasta el ancho del armazón. --section-gap separa cabecera, bloque y lista.
     */
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--section-gap);
      max-width: var(--content-max);
      min-width: 0;
    }
    .fc-revc__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    /* El escalón de h1 de página lo pone tokens/base.css; aquí solo el margen. */
    .fc-revc__title {
      margin: 0;
      overflow-wrap: anywhere;
    }
    /* Título del bloque: rol h2 del brief §3 (26 px) y 12 px hasta el cuerpo. */
    .fc-revc__seccion {
      margin: 0 0 var(--space-3);
    }
    .fc-revc__intro {
      margin: 0;
      max-width: var(--reading-max);
      font-size: var(--fs-secondary);
      line-height: var(--lh-secondary);
      color: var(--fc-ink-2);
    }
    .fc-revc__lista {
      display: flex;
      flex-direction: column;
    }
    /* Las filas se separan por su regla de 1 px, no por un hueco; en el estado de carga
       no hay reglas, así que las dos barras esqueleto sí necesitan aire entre ellas. */
    .fc-revc__lista > fc-skeleton + fc-skeleton {
      margin-top: var(--space-2);
    }
    .fc-revc__item {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-4) 0;
      border-bottom: var(--border-hairline) solid var(--fc-line);
      min-width: 0;
    }
    .fc-revc__item:first-child {
      border-top: var(--border-hairline) solid var(--fc-line);
    }
    .fc-revc__cabecera {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    /* Sin talla propia: el «h3» de base ya fija título de bloque (19 / 1.35 / 600). */
    .fc-revc__nombre {
      margin: 0;
    }
    /* Pie de la fila: 13 px y tinta terciaria, debajo del nombre y de las salidas. */
    .fc-revc__cuerpo {
      display: flex;
      gap: var(--space-1) var(--space-4);
      flex-wrap: wrap;
      align-items: baseline;
      margin: 0;
      color: var(--fc-ink-3);
      font-size: var(--fs-meta);
      line-height: var(--lh-meta);
    }
    .fc-revc__indicadores {
      font-family: var(--font-mono);
    }
    .fc-revc__salidas {
      margin: 0;
      padding-left: var(--space-4);
      font-size: var(--fs-secondary);
      line-height: var(--lh-secondary);
      color: var(--fc-ink-2);
    }
    .fc-revc__acciones {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin-top: var(--space-1);
    }
    /* El motivo del rechazo es un campo de formulario: ahí el borde de 1 px sí separa
       dos superficies funcionales (brief §5). */
    .fc-revc__rechazo {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding-top: var(--space-3);
      border-top: var(--border-hairline) solid var(--fc-line);
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
