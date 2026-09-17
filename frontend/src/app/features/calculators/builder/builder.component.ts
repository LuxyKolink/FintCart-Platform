import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import {
  BadgeComponent,
  BannerComponent,
  ButtonComponent,
  ErrorStateComponent,
  InputComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  SelectComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import { CalculatorError, CalculatorsApiService } from '../calculators-api.service';
import {
  Calculator,
  DefinitionIssue,
  calculatorStateHelp,
  calculatorStateLabel,
  calculatorStateTone,
} from '../calculator.types';
import {
  CalculatorDraft,
  INPUT_TYPE_OPTIONS,
  UNIT_SUGGESTIONS,
  describeIssue,
  draftFrom,
  emptyDraft,
  emptyInput,
  emptyResult,
  emptyRule,
  issueControlPath,
  toWriteBody,
} from './builder.types';

type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved';

/** Cuánto se espera tras la última tecla antes de preguntarle al servidor (FR-046). */
const LIVE_VALIDATION_MS = 400;

/**
 * Constructor visual de calculadoras (T097, FR-043…FR-046).
 *
 * ## Qué se decide aquí y qué se decide en el servidor
 *
 * Aquí no se decide si una definición es válida. El analizador vive en el Simulador, y **esta
 * pantalla pregunta**: manda la definición a `POST /calculators/validate` y enseña lo que
 * responde, con la ubicación de cada problema resaltando su campo. Duplicar aquí las reglas
 * —qué funciones existen, qué referencias son válidas, si una tasa puede ser negativa— sería
 * tener dos analizadores que se desincronizan, y el del cliente siempre sería el equivocado.
 *
 * ## Por qué la comprobación en vivo va con retardo
 *
 * Cada tecla es un cambio de definición, y validar en cada una mandaría una petición por pulsación
 * —escribir «presupuesto» son once—. Con 400 ms de retardo se manda una sola vez, cuando el autor
 * se detiene, y `distinctUntilChanged` evita repetir la misma consulta si vuelve al estado
 * anterior. El retardo no cambia QUÉ se pregunta, solo cuándo.
 *
 * ## Guardar no publica
 *
 * Una calculadora nace `privada` (FR-051) y editar una publicada **no cambia lo que el catálogo
 * sirve**: crea una versión nueva que sigue privada hasta que un coordinador la apruebe
 * (FR-052). La pantalla lo dice en el sitio donde importa —al guardar una que ya está
 * publicada—, porque es lo que evita el malentendido de creer que se acaba de cambiar el
 * catálogo.
 */
@Component({
  selector: 'fc-calculator-builder',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    BadgeComponent,
    BannerComponent,
    ButtonComponent,
    ErrorStateComponent,
    InputComponent,
    LinkButtonComponent,
    ModuleBoxComponent,
    SelectComponent,
    SkeletonComponent,
  ],
  templateUrl: './builder.component.html',
  styles: `
    :host {
      display: block;
    }
    .fc-build__intro {
      max-width: 68ch;
      color: var(--text-body);
    }
    .fc-build__rejilla {
      display: grid;
      gap: var(--space-3);
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    }
    .fc-build__fila {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      align-items: end;
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: var(--surface-sunken);
    }
    .fc-build__quitar {
      justify-self: start;
    }
    .fc-build__panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .fc-build__problemas {
      margin: 0;
      padding-left: var(--space-4);
      color: var(--text-body);
      font-size: var(--fs-sm);
    }
    .fc-build__ubicacion {
      font-family: var(--font-mono);
    }
    .fc-build__acciones {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      align-items: center;
    }
    .fc-build__estado {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      flex-wrap: wrap;
    }
  `,
})
export class CalculatorBuilderComponent implements OnInit {
  private readonly api = inject(CalculatorsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly state = signal<LoadState>('ready');
  protected readonly save = signal<SaveState>('idle');
  protected readonly issues = signal<DefinitionIssue[]>([]);
  protected readonly valid = signal<boolean | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** La calculadora que se edita, o `null` si es nueva. */
  protected readonly editing = signal<Calculator | null>(null);
  /** Se guardó y ya tiene identificador: es lo que permite ofrecer «ver y ejecutar». */
  protected readonly savedId = signal<string | null>(null);

  protected readonly typeOptions = INPUT_TYPE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  protected readonly unitOptions = UNIT_SUGGESTIONS.map((unit) => ({ value: unit, label: unit }));
  protected readonly canSave = computed(() => this.save() !== 'saving' && this.state() === 'ready');

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true }),
    inputs: new FormArray<FormGroup>([]),
    validations: new FormArray<FormGroup>([]),
    outputs: new FormArray<FormGroup>([]),
  });

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('calculatorId');

    if (id === null || id === '') {
      this.applyDraft(emptyDraft());
      this.watchForChanges();
      return;
    }

    this.state.set('loading');
    this.api.get(id).subscribe({
      next: (calculator) => {
        this.editing.set(calculator);
        this.savedId.set(calculator.calculator_id);
        this.applyDraft(draftFrom(calculator));
        this.state.set('ready');
        this.watchForChanges();
      },
      error: (err: unknown) => {
        this.state.set('error');
        this.errorMessage.set(
          err instanceof CalculatorError ? err.message : 'No pudimos cargar la calculadora.',
        );
      },
    });
  }

  protected get inputs(): FormArray<FormGroup> {
    return this.form.controls.inputs;
  }

  protected get validations(): FormArray<FormGroup> {
    return this.form.controls.validations;
  }

  protected get outputs(): FormArray<FormGroup> {
    return this.form.controls.outputs;
  }

  protected addInput(): void {
    this.inputs.push(this.inputGroup(emptyInput()));
  }

  protected addRule(): void {
    this.validations.push(this.ruleGroup(emptyRule()));
  }

  protected addOutput(): void {
    this.outputs.push(this.resultGroup(emptyResult()));
  }

  protected removeInput(index: number): void {
    this.inputs.removeAt(index);
  }

  protected removeRule(index: number): void {
    this.validations.removeAt(index);
  }

  protected removeOutput(index: number): void {
    this.outputs.removeAt(index);
  }

  /** El grupo de una fila, para el `[formGroup]` de la plantilla. */
  protected groupAt(array: FormArray<FormGroup>, index: number): FormGroup {
    return array.at(index);
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

  /** El texto de un problema, con su ubicación delante. */
  protected describe(issue: DefinitionIssue): string {
    return describeIssue(issue);
  }

  /** El error de un campo concreto, si el servidor lo señaló (FR-046). */
  protected fieldError(path: string): string | undefined {
    const issue = this.issues().find((candidate) => issueControlPath(candidate.location) === path);
    return issue?.message;
  }

  /**
   * Los problemas que no apuntan a un campo concreto.
   *
   * Se enseñan en el panel general. Un problema sin ubicación de fila —o con una que esta pantalla
   * no sabe traducir— no se puede resaltar en ningún sitio, y enseñarlo dos veces o inventarle un
   * campo sería peor que enseñarlo una vez sin marca.
   */
  protected generalIssues(): DefinitionIssue[] {
    return this.issues().filter((issue) => issueControlPath(issue.location) === null);
  }

  /** Pregunta al servidor ahora mismo, sin esperar al retardo (FR-046). */
  protected onValidate(): void {
    this.askTheServer();
  }

  protected onSave(): void {
    if (this.save() === 'saving') {
      return;
    }

    const body = toWriteBody(this.readDraft());
    this.save.set('saving');
    this.errorMessage.set(null);
    this.notice.set(null);

    const existing = this.editing();
    const request =
      existing === null ? this.api.create(body) : this.api.update(existing.calculator_id, body);

    request.subscribe({
      next: (calculator) => {
        this.save.set('saved');
        this.savedId.set(calculator.calculator_id);
        this.editing.set(calculator);
        this.issues.set([]);
        this.valid.set(true);
        this.notice.set(
          existing === null
            ? `«${calculator.name}» quedó guardada y es privada: solo la ves tú. Ejecútala abajo y, cuando te convenza, propónla para el catálogo.`
            : `Guardada la versión ${calculator.version} de «${calculator.name}».`,
        );
        // La ruta cambia a la de edición para que recargar la página no cree OTRA calculadora:
        // sin esto, un F5 sobre `/calculadoras/nueva` con un borrador ya guardado duplicaría la
        // calculadora, y el autor tendría dos iguales sin haberlo pedido.
        if (existing === null) {
          void this.router.navigate(['/calculadoras', calculator.calculator_id, 'editar'], {
            replaceUrl: true,
          });
        }
      },
      error: (err: unknown) => {
        this.save.set('idle');
        if (err instanceof CalculatorError) {
          this.errorMessage.set(err.message);
          // Un 422 trae la lista de problemas: se enseña en los campos, que es donde el autor
          // puede hacer algo con ella.
          this.issues.set(err.issues);
          this.valid.set(false);
          return;
        }
        this.errorMessage.set('No pudimos guardar la calculadora.');
      },
    });
  }

  protected onRetry(): void {
    this.ngOnInit();
  }

  /**
   * El borrador que hay ahora mismo en el formulario.
   *
   * Se lee del formulario y no de una copia del modelo: el autor puede haber dejado el foco en un
   * campo sin salir de él, y un `signal` actualizado en cada tecla tendría una versión distinta de
   * la que se ve. Lo que se manda es lo que está escrito.
   */
  private readDraft(): CalculatorDraft {
    const raw = this.form.getRawValue();
    return {
      name: raw.name,
      description: raw.description,
      inputs: raw.inputs as CalculatorDraft['inputs'],
      validations: raw.validations as CalculatorDraft['validations'],
      outputs: raw.outputs as CalculatorDraft['outputs'],
    };
  }

  /** Pinta un borrador en el formulario, reemplazando sus listas. */
  private applyDraft(draft: CalculatorDraft): void {
    this.form.controls.name.setValue(draft.name);
    this.form.controls.description.setValue(draft.description);
    this.inputs.clear();
    this.validations.clear();
    this.outputs.clear();
    for (const row of draft.inputs) {
      this.inputs.push(this.inputGroup(row));
    }
    for (const row of draft.validations) {
      this.validations.push(this.ruleGroup(row));
    }
    for (const row of draft.outputs) {
      this.outputs.push(this.resultGroup(row));
    }
  }

  /**
   * La comprobación en vivo (FR-046).
   *
   * Se engancha al formulario ENTERO y no a cada control: un problema puede depender de dos
   * campos a la vez —una expresión que referencia una entrada que se acaba de renombrar—, así que
   * escuchar por campo perdería justo los cambios que más importan.
   */
  private watchForChanges(): void {
    this.form.valueChanges.pipe(debounceTime(LIVE_VALIDATION_MS), distinctUntilChanged()).subscribe(() => {
      this.askTheServer();
    });
  }

  private askTheServer(): void {
    const body = toWriteBody(this.readDraft());
    this.api.validate(body).subscribe({
      next: (report) => {
        this.valid.set(report.valid);
        this.issues.set(report.errors);
      },
      error: () => {
        // Un fallo de red no convierte la definición en inválida: se deja el último veredicto y
        // se calla. Afirmar «tiene problemas» cuando el problema es la conexión sería mentir
        // sobre el trabajo del autor, y el aviso de la conexión ya lo da el guardado.
        this.valid.set(null);
      },
    });
  }

  private inputGroup(row: ReturnType<typeof emptyInput>): FormGroup {
    return new FormGroup({
      key: new FormControl(row.key, { nonNullable: true }),
      label: new FormControl(row.label, { nonNullable: true }),
      type: new FormControl(row.type, { nonNullable: true }),
      unit: new FormControl(row.unit, { nonNullable: true }),
      min_value: new FormControl(row.min_value, { nonNullable: true }),
      max_value: new FormControl(row.max_value, { nonNullable: true }),
      default_value: new FormControl(row.default_value, { nonNullable: true }),
      required: new FormControl(row.required, { nonNullable: true }),
    });
  }

  private ruleGroup(row: ReturnType<typeof emptyRule>): FormGroup {
    return new FormGroup({
      expression: new FormControl(row.expression, { nonNullable: true }),
      message: new FormControl(row.message, { nonNullable: true }),
    });
  }

  private resultGroup(row: ReturnType<typeof emptyResult>): FormGroup {
    return new FormGroup({
      key: new FormControl(row.key, { nonNullable: true }),
      label: new FormControl(row.label, { nonNullable: true }),
      expression: new FormControl(row.expression, { nonNullable: true }),
      scale: new FormControl(row.scale, { nonNullable: true }),
      when: new FormControl(row.when, { nonNullable: true }),
    });
  }
}
