import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CalculatorsApiService } from '../calculators-api.service';
import { Calculator } from '../calculator.types';
import { CalculatorRunnerComponent } from './runner.component';

/**
 * Ejecutor de una calculadora definida por un usuario (T119, FR-050).
 *
 * ## Qué fija esta prueba, y por qué existe
 *
 * El formulario se arma **a partir de la definición**, así que lo que hay que comprobar no son
 * unos campos concretos sino que la definición se LEA COMO VIENE. Aquí se encontró el defecto que
 * la motivó: el ejecutor leía `min`/`max`/`default` y el contrato manda
 * `min_value`/`max_value`/`default_value`, de modo que las cotas valían `undefined` y **no se
 * comprobaba ninguna**, ni se rellenaba ningún valor por defecto. Todo parecía funcionar porque
 * las calculadoras de las pruebas se ejecutaban con valores dentro del rango.
 *
 * Por eso las dos primeras pruebas están escritas contra el JSON **tal como lo manda el borde** y
 * no contra una definición inventada por la prueba: una definición escrita con los nombres
 * equivocados habría pasado.
 */
describe('CalculatorRunnerComponent', () => {
  let api: { get: jasmine.Spy; run: jasmine.Spy };

  /** La definición con los nombres del contrato: `min_value`, `max_value`, `default_value`. */
  const calculadora: Calculator = {
    calculator_id: 'c1',
    name: 'Cuota con interés',
    description: 'La cuota de un crédito',
    is_builtin: false,
    state: 'publicada',
    version: 3,
    definition: {
      inputs: [
        {
          key: 'monto',
          label: 'Monto del crédito',
          type: 'monto',
          unit: 'COP',
          min_value: '1000',
          max_value: '1000000',
          default_value: '500000',
          required: true,
        },
      ],
      validations: [],
      outputs: [{ key: 'cuota', label: 'Cuota mensual', expression: 'monto * 2', scale: 2 }],
    },
    indicators_used: [],
  };

  beforeEach(() => {
    api = {
      get: jasmine.createSpy('get').and.returnValue(of(calculadora)),
      run: jasmine.createSpy('run').and.returnValue(
        of({ simulation_id: 's1', result: { cuota: '1000000.00' }, calculator_version: 3, indicators_used: {} }),
      ),
    };
  });

  async function render(): Promise<ComponentFixture<CalculatorRunnerComponent>> {
    await TestBed.configureTestingModule({
      imports: [CalculatorRunnerComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (): string => 'c1' } } } },
        { provide: CalculatorsApiService, useValue: api },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CalculatorRunnerComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ComponentFixture<CalculatorRunnerComponent>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function campo(fixture: ComponentFixture<CalculatorRunnerComponent>): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
  }

  it('usa el VALOR POR DEFECTO que declara la definición', async () => {
    const fixture = await render();
    expect(campo(fixture).value).toBe('500000');
  });

  it('rechaza un valor fuera de las cotas declaradas (FR-044)', async () => {
    // Las cotas se leen como `min_value`/`max_value`: si la ayuda volviera a leer `min`/`max`,
    // este valor pasaría y la prueba fallaría, que es justo lo que tiene que pasar.
    const fixture = await render();
    const component = fixture.componentInstance as unknown as {
      form: { get: (key: string) => { setValue: (v: string) => void } | null };
    };

    component.form.get('monto')?.setValue('2000000');
    fixture.detectChanges();

    const control = fixture.componentInstance as unknown as {
      form: { get: (key: string) => { valid: boolean } | null };
    };
    expect(control.form.get('monto')?.valid).toBeFalse();

    component.form.get('monto')?.setValue('500');
    fixture.detectChanges();
    expect(control.form.get('monto')?.valid).toBeFalse();

    component.form.get('monto')?.setValue('999999');
    fixture.detectChanges();
    expect(control.form.get('monto')?.valid).toBeTrue();
  });

  it('ejecuta con las cadenas que se escribieron, sin pasar por number (Principio VIII)', async () => {
    const fixture = await render();
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((boton) => (boton.textContent ?? '').includes('Calcular'))
      ?.click();
    fixture.detectChanges();

    expect(api.run).toHaveBeenCalledWith('c1', { monto: '500000' });
    // El resultado sale formateado con la escala que declaró el autor, y SIN símbolo de moneda:
    // la definición no dice si son pesos, una tasa o unos meses, y poner «$» inventaría un dato.
    expect(text(fixture)).toContain('1.000.000,00');
    expect(text(fixture)).not.toContain('$');
  });

  it('dice con qué versión se calculó (FR-050)', async () => {
    const fixture = await render();
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((boton) => (boton.textContent ?? '').includes('Calcular'))
      ?.click();
    fixture.detectChanges();

    expect(text(fixture)).toContain('versión 3');
  });
});
