import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import {
  BannerComponent,
  ButtonComponent,
  ErrorStateComponent,
  InputComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  SelectComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import * as decimalStr from '../../../shared/decimal-str';
import { CalculatorDefinition, CalculatorMode, FieldConfig, calculatorFor } from '../calculators.config';
import { moneyValidator, periodsValidator, rateValidator } from '../decimal-validators';
import { calcLabelOf, primaryResult } from '../history-rows';
import { CalculatorRailComponent } from '../rail/calculator-rail.component';
import { ResultComponent } from '../result/result.component';
import { SimulationError, SimulatorsService } from '../simulators.service';
import { CalcType, SimulationHistoryEntry, SimulationResult } from '../simulators.types';

type LoadState = 'ready' | 'not-found';
type SubmitState = 'idle' | 'submitting' | 'error';
type PanelState = 'loading' | 'ready' | 'error';

/** Cuántas simulaciones recientes caben en el riel sin que haya que desplazarse. */
const RECENT_LIMIT = 3;

/**
 * Formulario de parámetros de una calculadora (T125, FR-019–FR-021).
 *
 * Un solo componente para las cinco calculadoras: el conjunto de campos varía por
 * `calcType` y, para `colombia_especifica`, también por modo (`operacion`) — ambos
 * vienen de `calculators.config.ts`, así que añadir una calculadora no exige un
 * componente nuevo.
 *
 * **Validación decimal con `decimal.js` (`shared/decimal-str.ts`), no `big.js`.**
 * T125 nombraba `big.js`, pero el resto del frontend (`quiz.component.ts`, el propio
 * `shared/decimal-str.ts`) ya usa `decimal.js` como la única librería decimal del
 * proyecto — sumar `big.js` solo para este formulario introduciría una segunda
 * semántica decimal sin necesidad real, que es justo lo que el Principio VIII busca
 * evitar. La validación aquí es de todas formas solo retroalimentación inmediata: el
 * borde devuelve "petición inválida" sin detalle para cualquier parámetro rechazado
 * (`mapping.go::httpFromGRPC`), así que quien de verdad decide si un valor es válido
 * sigue siendo el Simulador (Rust).
 */
@Component({
  selector: 'fc-simulator-form',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    BannerComponent,
    ButtonComponent,
    CalculatorRailComponent,
    ErrorStateComponent,
    InputComponent,
    LinkButtonComponent,
    ModuleBoxComponent,
    ResultComponent,
    SelectComponent,
    SkeletonComponent,
  ],
  templateUrl: './simulator-form.component.html',
  styleUrl: './simulator-form.component.css',
})
export class SimulatorFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(SimulatorsService);

  protected readonly state = signal<LoadState>('ready');
  protected readonly definition = signal<CalculatorDefinition | null>(null);
  protected readonly mode = signal<CalculatorMode | null>(null);
  protected readonly form = signal<FormGroup>(new FormGroup({}));
  protected readonly crossFieldError = signal(false);

  protected readonly submitState = signal<SubmitState>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<SimulationResult | null>(null);

  /**
   * Riel de «últimas simulaciones». Es la tercera zona del kit y la única forma de
   * comparar sin salir del formulario. Vive aparte del resultado: que falle no puede
   * impedir calcular.
   */
  protected readonly recentState = signal<PanelState>('loading');
  protected readonly recent = signal<SimulationHistoryEntry[]>([]);

  /**
   * Indicadores que el modo actual necesita y que NO tienen vigencia hoy (FR-062).
   *
   * Va aparte del resto de la carga y NO bloquea: si `/indicators/current` falla, no hay
   * aviso y la calculadora sigue funcionando. Una advertencia que se convirtiera en un
   * error de carga impediría calcular por un dato que solo matiza el resultado.
   */
  protected readonly missingIndicators = signal<string[]>([]);

  /**
   * Indicadores que el modo actual necesita y que NO tienen vigencia hoy (FR-062).
   *
   * Se DERIVA de la lista del servidor y de lo que declara el modo, en vez de guardarse
   * en una señal que hubiera que mantener al día: al cambiar de calculadora —o de modo
   * dentro de `colombia_especifica`— el aviso se recalcula solo.
   */
  protected readonly staleIndicators = computed<string[]>(() => {
    const mode = this.mode();
    if (mode === null) {
      return [];
    }
    const faltan = new Set(this.missingIndicators());
    return (mode.indicators ?? []).filter((name) => faltan.has(name));
  });

  private calcType: CalcType | null = null;

  public ngOnInit(): void {
    const raw = this.route.snapshot.paramMap.get('calcType') ?? '';
    const def = calculatorFor(raw as CalcType);
    if (def === undefined) {
      this.state.set('not-found');
      return;
    }
    this.calcType = def.calcType;
    this.definition.set(def);
    this.loadRecent();
    this.loadIndicators();
    const firstMode = def.modes[0];
    if (firstMode !== undefined) {
      this.selectMode(firstMode);
    }
  }

  protected selectModeValue(value: string): void {
    const found = this.definition()?.modes.find((candidate) => candidate.value === value);
    if (found !== undefined) {
      this.selectMode(found);
    }
  }

  /**
   * Pregunta qué indicadores se quedaron sin vigencia y se queda con los que este modo
   * usa. El aviso se DERIVA del modo elegido y no se guarda por modo: al cambiar de
   * calculadora —o de modo dentro de `colombia_especifica`— la lista se recalcula sola.
   */
  private loadIndicators(): void {
    this.api.currentIndicators().subscribe({
      next: (vigentes) => this.missingIndicators.set(vigentes.missing_names),
      // Sin red no hay aviso, pero tampoco un error: el usuario vino a calcular.
      error: () => this.missingIndicators.set([]),
    });
  }

  private selectMode(mode: CalculatorMode): void {
    this.mode.set(mode);
    this.result.set(null);
    this.errorMessage.set(null);
    this.crossFieldError.set(false);
    this.submitState.set('idle');
    this.form.set(this.buildForm(mode));
  }

  private buildForm(mode: CalculatorMode): FormGroup {
    const controls: Record<string, FormControl<string>> = {};
    for (const field of mode.fields) {
      controls[field.key] = new FormControl<string>(this.defaultValue(field), {
        nonNullable: true,
        validators: this.validatorsFor(field),
      });
    }
    return new FormGroup(controls);
  }

  private defaultValue(field: FieldConfig): string {
    return field.kind === 'select' ? (field.options?.[0]?.value ?? '') : '';
  }

  private validatorsFor(field: FieldConfig): ValidatorFn[] {
    switch (field.kind) {
      case 'money':
        return [moneyValidator({ required: field.required, strictlyPositive: field.strictlyPositive })];
      case 'rate':
        return [
          rateValidator({
            required: field.required,
            forbidNegative: field.forbidNegative,
            floorExclusive: field.floorExclusive,
          }),
        ];
      case 'periods':
        return [periodsValidator()];
      case 'select':
        return field.required ? [Validators.required] : [];
    }
  }

  protected onSubmit(): void {
    const mode = this.mode();
    const form = this.form();
    if (mode === null || this.calcType === null || this.submitState() === 'submitting') {
      return;
    }
    form.markAllAsTouched();
    if (form.invalid) {
      return;
    }
    if (!this.satisfiesAtLeastOne(mode, form)) {
      this.crossFieldError.set(true);
      return;
    }
    this.crossFieldError.set(false);

    const inputs: Record<string, string> = {};
    for (const field of mode.fields) {
      const raw = form.get(field.key)?.value as string;
      // Un campo opcional vacío se OMITE, no se envía como "": para el Simulador
      // "ausente" y "0" significan lo mismo en un aporte, pero una tasa opcional
      // ausente (inflación) es distinta de una tasa opcional en cero (ver
      // `inversion.rs`) — omitir la clave es lo único que preserva esa diferencia.
      if (raw !== '') {
        inputs[field.key] = raw;
      }
    }
    if (mode.value !== '') {
      inputs['operacion'] = mode.value;
    }

    this.submitState.set('submitting');
    this.errorMessage.set(null);
    this.api.run(this.calcType, { currency: 'COP', inputs }).subscribe({
      next: (res) => {
        this.submitState.set('idle');
        this.result.set(res);
        // El servidor guarda el intento al ejecutarlo, así que el riel se relee para
        // reflejarlo: si no, el usuario vería «todavía no has guardado ninguna» justo
        // después de guardar una.
        this.loadRecent();
      },
      error: (err: unknown) => {
        this.submitState.set('error');
        this.errorMessage.set(
          err instanceof SimulationError ? err.message : 'No pudimos completar la operación. Intenta de nuevo.',
        );
      },
    });
  }

  protected labelOf(entry: SimulationHistoryEntry): string {
    return calcLabelOf(entry);
  }

  protected primaryOf(entry: SimulationHistoryEntry): { label: string; value: string } {
    return primaryResult(entry);
  }

  protected fieldError(key: string): string | null {
    const control = this.form().get(key);
    if (control === null || !control.touched || control.errors === null) {
      return null;
    }
    const errors = control.errors;
    if (errors['required'] !== undefined) {
      return 'Este campo es obligatorio.';
    }
    if (errors['decimalFormat'] !== undefined) {
      return 'Formato inválido — usa un número con punto decimal, sin separador de miles.';
    }
    if (errors['negative'] !== undefined) {
      return 'No puede ser negativo.';
    }
    if (errors['mustBePositive'] !== undefined) {
      return 'Debe ser mayor que cero.';
    }
    if (errors['belowFloor'] !== undefined) {
      return 'El valor es demasiado bajo (no puede ser -100 % o menos).';
    }
    if (errors['integerFormat'] !== undefined) {
      return 'Debe ser un número entero.';
    }
    if (errors['periodsRange'] !== undefined) {
      return 'Debe estar entre 1 y 1200.';
    }
    return 'Valor inválido.';
  }

  private loadRecent(): void {
    this.recentState.set('loading');
    this.api.listHistory(undefined).subscribe({
      next: (page) => {
        this.recent.set(page.items.slice(0, RECENT_LIMIT));
        this.recentState.set('ready');
      },
      error: () => this.recentState.set('error'),
    });
  }

  private satisfiesAtLeastOne(mode: CalculatorMode, form: FormGroup): boolean {
    if (mode.atLeastOneOf === undefined) {
      return true;
    }
    return mode.atLeastOneOf.some((key) => {
      const raw = form.get(key)?.value as string;
      if (raw === '') {
        return false;
      }
      try {
        return !decimalStr.parseMoney(raw).isZero();
      } catch {
        return false;
      }
    });
  }
}
