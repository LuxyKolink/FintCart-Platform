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
import { formatMoney, formatRate } from '../../../shared/format-money';
import { toColombian } from '../../../shared/format-number';
import { resultKindOf } from '../../simulators/calculators.config';
import { calculatorTitle } from '../calculator-title';
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
 *
 * ## Una sola columna, a la medida de formulario (brief §8)
 *
 * Los campos ocupaban el ancho entero del contenedor —1090 px en el render—, así que un campo
 * de «Depósito inicial» medía más que un renglón de lectura. Ahora la entrada se limita a
 * `--reading-max` (680 px), que es la medida que el brief fija para los formularios de los
 * simuladores y de las calculadoras. `--form-max` no sirve aquí: vale 400 px porque describe el
 * formulario de ACCESO.
 *
 * El resultado va en una BANDA con regla superior (brief §8), no en un bloque hermano pegado al
 * botón: el título «Resultado» caía a 0 px de «Calcular» y la salida se leía como una fila más
 * del formulario.
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

    .fc-run {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      min-width: 0;
      max-width: var(--content-max);
    }

    .fc-run__entrada {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      /* Medida de entrada: el formulario y su cabecera, juntos. */
      max-width: var(--reading-max);
    }

    /* h1 de página: escalón display del brief §3 (38 / 1.15 / 500 / -0.02em). */
    .fc-run__title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-display);
      line-height: var(--lh-display);
      font-weight: var(--fw-display);
      letter-spacing: var(--ls-display);
      color: var(--text-strong);
      overflow-wrap: anywhere;
    }

    .fc-run__cabecera {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }

    .fc-run__version {
      font-size: var(--fs-meta);
      color: var(--text-muted);
    }

    .fc-run__intro {
      margin: 0;
      font-size: var(--fs-ui);
      color: var(--text-body);
    }

    .fc-run__parametros {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      max-width: var(--reading-max);
    }

    /* Título de sección: escalón h2 del brief §3 (26 / 1.25 / 500 / -0.01em). */
    .fc-run__section {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-h2);
      line-height: var(--lh-h2);
      font-weight: var(--fw-h2);
      letter-spacing: var(--ls-h2);
      color: var(--text-strong);
    }

    .fc-run__form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    .fc-run__acciones {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }

    /*
      La banda de resultado: regla superior de 1 px y espacio. Es el recurso que el brief §5
      admite para separar dos superficies funcionales, y aquí separa la ENTRADA de la SALIDA.
    */
    .fc-run__banda {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      max-width: var(--reading-max);
      padding-top: var(--space-5);
      border-top: var(--border-hairline) solid var(--fc-line);
    }

    .fc-run__resultado {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .fc-run__valor {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-2) var(--space-4);
      flex-wrap: wrap;
      padding: var(--space-2) 0;
      border-bottom: var(--border-hairline) solid var(--fc-line);
    }

    .fc-run__valor:last-child {
      border-bottom: 0;
    }

    .fc-run__etiqueta {
      font-size: var(--fs-secondary);
      color: var(--text-muted);
    }

    /* La cifra va con la tipografía de datos (.fc-num, ver tokens/base.css) y sin recorte
       posible (N-15). */
    .fc-run__cifra {
      margin-left: auto;
      font-size: var(--fs-h3);
      font-weight: var(--fw-semibold);
      color: var(--text-strong);
      text-align: right;
      white-space: nowrap;
    }

    .fc-run__procedencia {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--fs-meta);
    }

    .fc-run__indicadores {
      margin: 0;
      padding-left: var(--space-4);
      font-family: var(--font-mono);
      font-size: var(--fs-meta);
      color: var(--text-muted);
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
   * ## Cuándo lleva `$` y cuándo `%`, y por qué no es adivinar
   *
   * La definición NO declara el tipo de una salida: `CalculatorOutput` trae clave, etiqueta,
   * expresión, escala y condición, y nada más. Por eso el caso general imprime el valor con la
   * escala que el autor SÍ declaró y sin unidad —`2.469,00`—, que es lo único que la definición
   * autoriza a afirmar.
   *
   * Ahora bien: `17.223.060,60` sin signo de peso no se lee como una cifra en pesos, y una tasa
   * impresa como `0,010000` no se lee como `1 %`. Las calculadoras de la PLATAFORMA sí tienen
   * tipo declarado, y lo tienen por la misma razón por la que su historial se lee bien: sus
   * definiciones semilla reutilizan las claves de salida de las nativas (FR-049), y el espejo de
   * esas claves y sus tipos vive en `simulators/calculators.config.ts` (`resultKindOf`). Así que
   * el tipo se resuelve por CLAVE y SOLO para una calculadora `is_builtin`: la de un usuario
   * lleva claves de su autor, nadie sabe si son pesos o meses, y ahí se mantiene la cifra sin
   * unidad. Adivinarlo por el tamaño —«si es menor que uno es una tasa»— convertiría un monto en
   * una tasa: una cifra falsa con apariencia de buena (N-15).
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
        value: this.present(output.key, result[output.key], output.scale, calculator.is_builtin),
      }));
  }

  /**
   * El valor de una salida, en la forma que se muestra.
   *
   * `formatMoney` y `formatRate` son de `shared/format-money.ts` y trabajan sobre la cadena
   * decimal canónica: nada de `Number`, `parseFloat` ni `toFixed` (Principio VIII). El respaldo
   * —escala declarada, agrupado local— es el formato del caso general; si ni eso se puede, se
   * enseña la cadena cruda antes que romper el resultado entero.
   */
  private present(key: string, raw: string, scale: number, builtin: boolean): string {
    const kind = builtin ? resultKindOf(key) : undefined;
    try {
      if (kind === 'money') {
        return formatMoney(raw);
      }
      if (kind === 'rate') {
        return formatRate(raw);
      }
    } catch {
      // Un valor que no cumple el formato canónico cae al respaldo: se muestra, no se esconde.
    }
    try {
      return toColombian(decimalStr.formatFixed(decimalStr.parse(raw), scale));
    } catch {
      return raw;
    }
  }

  /** El nombre legible: el de una semilla es un identificador, no un título. */
  protected title(calculator: Calculator): string {
    return calculatorTitle(calculator.name);
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
