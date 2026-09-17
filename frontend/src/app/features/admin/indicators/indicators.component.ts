import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  BadgeComponent,
  BannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  InputComponent,
  ModuleBoxComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import { AdminApiService, AdminError } from '../admin-api.service';
import {
  coversToday,
  describeValidTo,
  normalizeIndicatorValue,
  todayIso,
  validateIndicatorName,
  validateIndicatorValue,
  validateValidity,
} from './indicator-form';
import { CalendarStatus, Indicator } from './indicator.types';

type LoadState = 'loading' | 'ready' | 'error';
type Busy = 'create' | 'update' | null;

/**
 * Carga anual de indicadores financieros (US4, T108 — FR-055…FR-062).
 *
 * ## Para qué es esta pantalla
 *
 * Cada año cambian el salario mínimo, la UVT, la UVR, el IPC y la tasa de usura, y las
 * calculadoras los leen por nombre (`@UVT`). Cargar el valor del año es lo que mantiene
 * los resultados al día, y **olvidarlo no rompe nada de inmediato**: la calculadora que
 * usa `@UVT` sigue funcionando con el valor del año anterior hasta que alguien mira una
 * cifra mal. Por eso la pantalla abre con el estado del procedimiento —qué se quedó sin
 * vigencia y qué está por vencer— y no solo con el formulario.
 *
 * ## Lo que se decide aquí y lo que no
 *
 * El VALOR se captura y se envía como texto y pasa por `decimal.js` a través de
 * `indicator-form.ts`, nunca por `number` (Principio VIII). El SERVIDOR vuelve a
 * validarlo todo: esto son los avisos que evitan perder el formulario, no la garantía.
 *
 * Corregir una vigencia NO crea una nueva —es una errata de transcripción, no una
 * versión de la ley— y el nombre no se puede cambiar: es el vínculo con las fórmulas que
 * lo referencian. Las dos reglas viven en el Simulador y aquí solo se explican.
 */
@Component({
  selector: 'fc-admin-indicators',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModuleBoxComponent,
    InputComponent,
    ButtonComponent,
    BadgeComponent,
    BannerComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    SkeletonComponent,
  ],
  templateUrl: './indicators.component.html',
  styles: `
    :host {
      display: block;
    }
    .fc-ind__intro {
      max-width: 68ch;
      color: var(--text-body);
    }
    .fc-ind__estado {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .fc-ind__estado-lista {
      margin: 0;
      padding-left: var(--space-4);
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .fc-ind__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .fc-ind__fila {
      display: flex;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .fc-ind__campo {
      flex: 1 1 190px;
      min-width: 0;
    }
    .fc-ind__estado-titulo {
      margin: 0 0 var(--space-1);
      font-weight: var(--fw-semibold);
    }
    .fc-ind__atajos {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .fc-ind__lista {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .fc-ind__grupo + .fc-ind__grupo {
      margin-top: var(--space-4);
    }
    .fc-ind__grupo-titulo {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-2);
      font-size: var(--fs-md);
      font-weight: var(--fw-semibold);
    }
    .fc-ind__vigencia {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .fc-ind__vigencia:last-child {
      border-bottom: 0;
    }
    .fc-ind__vigencia-datos {
      flex: 1 1 260px;
      min-width: 0;
    }
    .fc-ind__vigencia-valor {
      font-family: var(--font-mono);
      font-weight: var(--fw-semibold);
    }
    .fc-ind__vigencia-fechas {
      color: var(--text-faint);
      font-size: var(--fs-sm);
    }
    .fc-ind__edicion {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .fc-ind__acciones {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
  `,
})
export class IndicatorsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly indicators = signal<Indicator[]>([]);
  protected readonly calendar = signal<CalendarStatus>({ missing_names: [], expiring: [] });
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly busy = signal<Busy>(null);
  /** `indicator_id` de la vigencia en edición, o `null`. */
  protected readonly editingId = signal<string | null>(null);
  /** Errores de los campos, que calcula `indicator-form`. */
  protected readonly valueError = signal<string | null>(null);
  protected readonly nameError = signal<string | null>(null);
  protected readonly validityError = signal<string | null>(null);
  /** Vigencias que ya existían cuando el borde rechazó por solapamiento (FR-059). */
  protected readonly solapadas = signal<Indicator[]>([]);

  protected readonly today = todayIso();

  /**
   * Nombres ya registrados, como atajos para rellenar el campo.
   *
   * Un nombre con una errata crea un indicador **invisible**: existiría en la tabla y
   * ninguna fórmula podría leerlo, que es exactamente el fallo que el `CHECK` de formato
   * existe para impedir. Por eso los conocidos se ofrecen a un clic. Escribir uno nuevo
   * sigue siendo posible —el campo es de texto libre—, pero deja de ser el camino por
   * defecto.
   */
  protected readonly knownNames = computed<string[]>(() =>
    [...new Set(this.indicators().map((i) => i.name))].sort(),
  );

  /** Vigencias agrupadas por nombre, de la más reciente a la más antigua. */
  protected readonly groups = computed(() => {
    const porNombre = new Map<string, Indicator[]>();
    for (const indicador of this.indicators()) {
      const lista = porNombre.get(indicador.name) ?? [];
      lista.push(indicador);
      porNombre.set(indicador.name, lista);
    }

    return [...porNombre.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, vigencias]) => ({
        name,
        vigencias: [...vigencias].sort((a, b) => b.valid_from.localeCompare(a.valid_from)),
      }));
  });

  /** La vigencia que se está corrigiendo, para el botón de guardar. */
  protected readonly editingIndicator = computed<Indicator | undefined>(() =>
    this.indicators().find((indicador) => indicador.indicator_id === this.editingId()),
  );

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    value: ['', [Validators.required]],
    validFrom: ['', [Validators.required]],
    validTo: ['', [Validators.required]],
  });

  public ngOnInit(): void {
    this.reload();
  }

  /** Rellena el nombre desde un atajo. */
  protected pickName(name: string): void {
    this.form.controls.name.setValue(name);
    this.nameError.set(null);
  }

  protected onCreate(): void {
    if (this.busy() !== null) {
      return;
    }
    const nombre = this.form.controls.name.value;
    const nameError = validateIndicatorName(nombre);
    const valueError = validateIndicatorValue(this.form.controls.value.value);
    const validityError = validateValidity(
      this.form.controls.validFrom.value,
      this.form.controls.validTo.value,
    );

    this.nameError.set(nameError);
    this.valueError.set(valueError);
    this.validityError.set(validityError);
    if (nameError !== null || valueError !== null || validityError !== null) {
      this.form.markAllAsTouched();
      return;
    }

    const body = {
      name: nombre.trim(),
      value: normalizeIndicatorValue(this.form.controls.value.value),
      valid_from: this.form.controls.validFrom.value,
      valid_to: this.form.controls.validTo.value,
    };

    this.busy.set('create');
    this.clearBanners();
    this.api.createIndicator(body).subscribe({
      next: (creado) => {
        this.busy.set(null);
        this.successMessage.set(
          `Vigencia de ${creado.name} cargada: ${creado.value} desde el ${creado.valid_from}.`,
        );
        this.resetForm();
        this.reload();
      },
      error: (err: unknown) => this.onFailure(err),
    });
  }

  protected startEdit(indicador: Indicator): void {
    this.editingId.set(indicador.indicator_id);
    this.clearBanners();
    this.valueError.set(null);
    this.nameError.set(null);
    this.validityError.set(null);
    this.form.setValue({
      name: indicador.name,
      value: indicador.value,
      validFrom: indicador.valid_from,
      validTo: indicador.valid_to,
    });
    // El nombre se DESHABILITA mientras se corrige: es el vínculo con las fórmulas que
    // referencian el indicador, y el servicio rechaza renombrar. Deshabilitarlo en vez
    // de dejarlo editable evita que alguien escriba encima y reciba un rechazo que no
    // puede entender.
    this.form.controls.name.disable();
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.resetForm();
  }

  protected onSaveEdit(indicador: Indicator | undefined): void {
    if (indicador === undefined || this.busy() !== null) {
      return;
    }
    const valueError = validateIndicatorValue(this.form.controls.value.value);
    const validityError = validateValidity(
      this.form.controls.validFrom.value,
      this.form.controls.validTo.value,
    );
    this.valueError.set(valueError);
    this.validityError.set(validityError);
    if (valueError !== null || validityError !== null) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set('update');
    this.clearBanners();
    this.api
      .updateIndicator(indicador.indicator_id, {
        // El nombre se envía igual pero no cambia: el servicio rechaza renombrar, y el
        // formulario de edición ni siquiera lo ofrece (está deshabilitado).
        name: indicador.name,
        value: normalizeIndicatorValue(this.form.controls.value.value),
        valid_from: this.form.controls.validFrom.value,
        valid_to: this.form.controls.validTo.value,
      })
      .subscribe({
        next: (guardado) => {
          this.busy.set(null);
          this.editingId.set(null);
          this.resetForm();
          this.successMessage.set(`Vigencia de ${guardado.name} corregida.`);
          this.reload();
        },
        error: (err: unknown) => this.onFailure(err),
      });
  }

  /**
   * Las vigencias por vencer, ya redactadas.
   *
   * La frase se arma aquí y no en la plantilla porque el recuento de días ES un número
   * —un int32 del contrato— y decidir entre «1 día» y «3 días» es una regla de
   * presentación, no una comparación de cifras: convertirlo en la vista deja la
   * aritmética decimal fuera del componente (Principio VIII).
   */
  protected readonly expiringView = computed(() =>
    this.calendar().expiring.map((item) => ({
      name: item.name,
      validTo: item.valid_to,
      quedan: item.days_remaining === 1 ? 'queda 1 día' : `quedan ${item.days_remaining} días`,
    })),
  );

  /** ¿Está esta vigencia en curso? Se marca en la lista para leerla sin hacer cuentas. */
  protected enCurso(indicador: Indicator): boolean {
    return coversToday(indicador.valid_from, indicador.valid_to, this.today);
  }

  protected readonly describeValidTo = describeValidTo;

  protected hayEstadoDelCalendario(): boolean {
    return this.calendar().missing_names.length > 0 || this.calendar().expiring.length > 0;
  }

  private onFailure(err: unknown): void {
    this.busy.set(null);
    const error =
      err instanceof AdminError
        ? err
        : new AdminError('server', 'No pudimos completar la operación. Intenta de nuevo.');
    // Las vigencias que chocan (FR-059) se muestran además en el aviso: sin ellas, «ya
    // existe» obliga a buscarlas a mano en la lista de abajo.
    this.solapadas.set(error.existing ?? []);
    this.errorMessage.set(error.message);
  }

  private resetForm(): void {
    // `enable()` antes de `reset()`: un control deshabilitado no vuelve a habilitarse
    // solo, y sin esto el formulario de carga quedaría con el nombre bloqueado.
    this.form.controls.name.enable();
    this.form.reset();
    this.valueError.set(null);
    this.nameError.set(null);
    this.validityError.set(null);
  }

  private clearBanners(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.solapadas.set([]);
  }

  private reload(): void {
    this.state.set('loading');
    this.api.listIndicators().subscribe({
      next: (indicators) => {
        this.indicators.set(indicators);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });

    // El estado del calendario no bloquea la pantalla: es contexto. Si falla, la lista
    // sigue siendo utilizable y el aviso simplemente no aparece — mejor que una pantalla
    // de error por un panel secundario.
    this.api.indicatorCalendarStatus().subscribe({
      next: (calendar) => this.calendar.set(calendar),
      error: () => this.calendar.set({ missing_names: [], expiring: [] }),
    });
  }
}
