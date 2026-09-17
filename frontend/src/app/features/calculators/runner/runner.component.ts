import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import {
  BadgeComponent,
  BannerComponent,
  ButtonComponent,
  ErrorStateComponent,
  InputComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import * as decimalStr from '../../../shared/decimal-str';
import { toColombian } from '../../../shared/format-number';
import { CalculatorError, CalculatorsApiService } from '../calculators-api.service';
import { Calculator, CalculatorField, calculatorStateHelp, calculatorStateLabel, calculatorStateTone } from '../calculator.types';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';
type PanelState = 'idle' | 'running' | 'done' | 'error';

/**
 * Ejecuta una calculadora DEFINIDA por un usuario (T119, FR-050; base de T153).
 *
 * ## Por qué el formulario se construye y no se declara
 *
 * Una calculadora de usuario no existe en el código: su conjunto de entradas vive en su
 * definición (`inputs[]`, con etiqueta, unidad, tipo y cotas), que el Simulador devuelve al
 * leerla. Este componente arma el formulario **a partir de esa definición**, y es el mismo
 * mecanismo que necesitará la calculadora incrustada en un artículo (T153): un formulario
 * escrito a mano por calculadora solo funcionaría para las que ya conocemos.
 *
 * ## Los valores NUNCA pasan por `number` (Principio VIII)
 *
 * El campo de un monto se valida con `decimal.js` (`shared/decimal-str.ts`) y se envía como la
 * cadena que escribió quien lo escribió. Convertirlo a `number` para «comprobar que es un
 * número» es exactamente el redondeo silencioso que el Principio VIII prohíbe: quien hace la
 * aritmética es el Simulador, con `rust_decimal`, y lo que aquí se comprueba es solo que el
 * texto sea un decimal con la forma que el campo declara.
 *
 * ## Estado público y estado privado
 *
 * La ruta es la misma para los dos: el Simulador decide qué se ve según el actor —el autor ve su
 * borrador, el resto solo la versión publicada (FR-052)—, así que esta pantalla no filtra nada
 * por su cuenta. Una calculadora privada de otra persona responde `NotFound`, y el mensaje lo
 * dice sin confirmar si existe.
 */
@Component({
  selector: 'fc-calculator-runner',
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
    SkeletonComponent,
  ],
  templateUrl: './runner.component.html',
  styles: `
    :host {
      display: block;
    }
    .fc-run__cabecera {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fc-run__intro {
      max-width: 68ch;
      color: var(--text-body);
    }
    .fc-run__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .fc-run__acciones {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fc-run__resultado {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin-top: var(--space-3);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border-subtle);
    }
    .fc-run__valor {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .fc-run__cifra {
      font-family: var(--font-mono);
      font-size: var(--fs-lg);
      font-weight: var(--fw-semibold);
    }
    .fc-run__procedencia {
      color: var(--text-faint);
      font-size: var(--fs-sm);
    }
    .fc-run__indicadores {
      margin: 0;
      padding-left: var(--space-4);
      font-family: var(--font-mono);
      font-size: var(--fs-sm);
      color: var(--text-faint);
    }
  `,
})
export class CalculatorRunnerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CalculatorsApiService);

  /**
   * La definición ya cargada, cuando la tiene quien usa este componente (T153).
   *
   * Un artículo incrustado ya tuvo que leer la calculadora para saber si sigue publicada
   * (FR-072), así que volver a pedirla aquí sería una segunda petición de lo mismo. Cuando llega
   * por aquí no se pide nada por la ruta: el componente pasa a ser «pinta y ejecuta esto».
   */
  public readonly definition = input<Calculator | null>(null);

  /**
   * `true` cuando el ejecutor va DENTRO de otra pantalla —un artículo—.
   *
   * Lo que cambia es que no se enseña el estado de la calculadora ni su ayuda —«Publicada» y un
   * párrafo que explica qué significa cada estado son información de quien la administra, no de
   * quien está leyendo un artículo— ni el enlace de vuelta al catálogo, que sacaría a quien lee
   * del artículo que estaba leyendo.
   */
  public readonly embedded = input<boolean>(false);

  protected readonly state = signal<LoadState>('loading');
  protected readonly calculator = signal<Calculator | null>(null);
  protected readonly panel = signal<PanelState>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<Record<string, string>>({});
  protected readonly provenance = signal<{ version: number; indicators: Record<string, string> } | null>(null);

  protected readonly form = new FormGroup({});

  /** Las entradas de la definición, en el orden en que el autor las declaró. */
  protected readonly fields = computed<CalculatorField[]>(() => this.calculator()?.definition.inputs ?? []);

  public ngOnInit(): void {
    // La definición que llega de fuera manda: quien la pasa ya la pidió.
    const yaCargada = this.definition();
    if (yaCargada !== null) {
      this.calculator.set(yaCargada);
      this.buildForm(yaCargada);
      this.state.set('ready');
      return;
    }

    const id = this.route.snapshot.paramMap.get('calculatorId') ?? '';
    if (id === '') {
      this.state.set('not-found');
      return;
    }

    this.api.get(id).subscribe({
      next: (calculator) => {
        this.calculator.set(calculator);
        this.buildForm(calculator);
        this.state.set('ready');
      },
      error: (err: unknown) => {
        this.state.set(err instanceof CalculatorError && err.kind === 'notFound' ? 'not-found' : 'error');
      },
    });
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

  protected controlOf(field: CalculatorField): FormControl {
    return this.form.get(field.key) as FormControl;
  }

  /** El nombre del campo tal como lo escribió el autor, para el mensaje de error. */
  protected labelOf(field: CalculatorField): string {
    return field.label === '' ? field.key : field.label;
  }

  /**
   * Las salidas del resultado, ya formateadas.
   *
   * ## Por qué aquí NO hay símbolo de moneda ni de porcentaje
   *
   * El caso de uso más frecuente de esta plataforma es una cifra en pesos, así que lo
   * tentador es poner `$` delante de todo. Estaría **inventando un dato**: la definición
   * declara la etiqueta, la expresión y la ESCALA de redondeo, y nada dice si el resultado son
   * pesos, una tasa o un número de meses. Un `0,25` presentado como `$0,25` cuando en realidad
   * es una tasa del 25 % es una cifra falsa con toda la apariencia de ser cierta — el fallo que
   * el Principio VIII existe para evitar, en su forma presentacional (nota N-15).
   *
   * Lo que sí se usa es la `escala` que el autor SÍ declaró: redondear a dos decimales cuando
   * declaró dos no es inventar nada, es respetar lo que decidió. El que lea el resultado tiene
   * la etiqueta delante —«Cuota mensual», «Equivalente en UVT»—, que es la que dice qué es.
   */
  protected outputs(): { label: string; value: string }[] {
    const calculator = this.calculator();
    const result = this.result();
    if (calculator === null) {
      return [];
    }
    return calculator.definition.outputs
      .filter((output) => result[output.key] !== undefined)
      .map((output) => ({
        label: output.label === '' ? output.key : output.label,
        value: toColombian(decimalStr.formatFixed(decimalStr.parse(result[output.key]), output.scale)),
      }));
  }

  /** Los indicadores que se usaron, con su valor del día de la ejecución (FR-058). */
  protected indicatorRows(): { name: string; value: string }[] {
    const used = this.provenance()?.indicators ?? {};
    return Object.entries(used).map(([name, value]) => ({ name, value }));
  }

  protected onSubmit(): void {
    const calculator = this.calculator();
    if (calculator === null || this.panel() === 'running') {
      return;
    }

    // Las dos comprobaciones importan y son distintas. `collectInputs` devuelve `null` cuando
    // falta un campo OBLIGATORIO —que no es lo mismo que un control inválido: un campo opcional
    // vacío es correcto—, y `form.invalid` cubre las COTAS declaradas, que la ayuda comprueba con
    // `decimal.js`. Sin la segunda, un valor fuera de rango se mandaba al servidor y el usuario
    // leía un error suyo en lugar de lo que ya sabía el formulario.
    const inputs = this.collectInputs();
    if (inputs === null || this.form.invalid) {
      this.form.markAllAsTouched();
      this.panel.set('error');
      this.errorMessage.set('Revisa los campos marcados.');
      return;
    }

    this.panel.set('running');
    this.errorMessage.set(null);
    this.result.set({});
    this.provenance.set(null);

    this.api.run(calculator.calculator_id, inputs).subscribe({
      next: (out) => {
        this.result.set(out.result);
        this.provenance.set({
          version: out.calculator_version ?? 0,
          indicators: out.indicators_used ?? {},
        });
        this.panel.set('done');
      },
      error: (err: unknown) => {
        this.panel.set('error');
        this.errorMessage.set(
          err instanceof CalculatorError ? err.message : 'No pudimos ejecutar la calculadora.',
        );
      },
    });
  }

  /**
   * Los valores del formulario, como cadenas, o `null` si alguno no sirve.
   *
   * Un campo opcional vacío **no viaja**: mandarlo como cadena vacía haría que el Simulador
   * viera «sin valor» en lugar de «no se envió» —proto3 no los distingue, y una validación de
   * dominio que dependa de que un parámetro no esté fallaría—.
   */
  private collectInputs(): Record<string, string> | null {
    const inputs: Record<string, string> = {};
    for (const field of this.fields()) {
      const control = this.controlOf(field);
      const raw = String(control.value ?? '').trim();
      if (raw === '') {
        if (field.required) {
          return null;
        }
        continue;
      }
      inputs[field.key] = raw;
    }
    return inputs;
  }

  /**
   * Arma un control por entrada, con los validadores que la definición declara.
   *
   * Las cotas (`min_value`/`max_value`) se comprueban con `decimal.js` y no con `Validators.min`,
   * que opera con `number`: comparar «1000000000000000000000» con un `number` no dice nada útil.
   * Y se leen con el nombre del CONTRATO: leerlas como `min`/`max` —que es lo que hacía esta
   * ayuda— las dejaba en `undefined` y no comprobaba nada (ver `CalculatorField`).
   */
  private buildForm(calculator: Calculator): void {
    for (const field of calculator.definition.inputs) {
      const validators = field.required ? [Validators.required] : [];
      this.form.addControl(
        field.key,
        new FormControl(field.default_value ?? '', {
          validators: [
            ...validators,
            (control: AbstractControl): ReturnType<typeof this.checkBounds> =>
              this.checkBounds(control.value, field),
          ],
        }),
      );
    }
  }

  private checkBounds(value: unknown, field: CalculatorField): { outsideBounds: true } | null {
    const raw = String(value ?? '').trim();
    if (raw === '') {
      return null;
    }
    try {
      const parsed = decimalStr.parse(raw);
      if (
        field.min_value !== undefined &&
        field.min_value !== '' &&
        parsed.lessThan(decimalStr.parse(field.min_value))
      ) {
        return { outsideBounds: true };
      }
      if (
        field.max_value !== undefined &&
        field.max_value !== '' &&
        parsed.greaterThan(decimalStr.parse(field.max_value))
      ) {
        return { outsideBounds: true };
      }
    } catch {
      return { outsideBounds: true };
    }
    return null;
  }
}
