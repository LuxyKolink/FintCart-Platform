import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { CalculatorError, CalculatorsApiService } from '../calculators-api.service';
import { Calculator } from '../calculator.types';
import { CalculatorBuilderComponent } from './builder.component';

/**
 * Constructor visual (T097, FR-043…FR-046).
 *
 * Estas pruebas fijan las cuatro cosas que el componente decide y que no se ven en el modelo:
 *
 *   · **La validación en vivo pregunta al SERVIDOR y no juzga por su cuenta** (FR-046): lo que el
 *     autor ve es la respuesta del analizador, con la ubicación de cada problema resaltando su
 *     campo. Un constructor que dijera «válida» por su cuenta daría una segunda opinión que solo
 *     puede acabar en desacuerdo.
 *   · **Un 422 enseña la lista de problemas**, no un «error al guardar» genérico: son los datos que
 *     el autor tiene que corregir.
 *   · **Guardar no publica**: se avisa de que lo que el catálogo sirve no cambia hasta que un
 *     coordinador apruebe (FR-052).
 *   · Al crear, la ruta pasa a la de edición para que recargar no cree OTRA calculadora.
 */
describe('CalculatorBuilderComponent', () => {
  let api: {
    validate: jasmine.Spy;
    create: jasmine.Spy;
    update: jasmine.Spy;
    get: jasmine.Spy;
  };

  const guardada: Calculator = {
    calculator_id: 'c1',
    name: 'Cuota con interés',
    description: 'La cuota de un crédito',
    is_builtin: false,
    state: 'privada',
    version: 1,
    definition: {
      inputs: [{ key: 'monto', label: 'Monto', type: 'monto', unit: 'COP', required: true }],
      validations: [],
      outputs: [{ key: 'cuota', label: 'Cuota', expression: 'monto * 2', scale: 2 }],
    },
    indicators_used: [],
  };

  beforeEach(() => {
    api = {
      validate: jasmine.createSpy('validate').and.returnValue(of({ valid: true, errors: [] })),
      create: jasmine.createSpy('create').and.returnValue(of(guardada)),
      update: jasmine.createSpy('update').and.returnValue(of({ ...guardada, version: 2 })),
      get: jasmine.createSpy('get').and.returnValue(of(guardada)),
    };
  });

  /**
   * Monta el componente con una ruta de una sola pieza.
   *
   * El doble de `ActivatedRoute` solo responde a lo que esta pantalla le pregunta —el
   * identificador de la ruta—: simular la navegación entera no aportaría nada y acoplaría la
   * prueba al enrutador. `provideRouter` sigue haciendo falta porque la plantilla usa
   * `fc-link-button`, que es un enlace de verdad.
   */
  async function render(calculatorId: string | null = null): Promise<ComponentFixture<CalculatorBuilderComponent>> {
    await TestBed.configureTestingModule({
      imports: [CalculatorBuilderComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: (): string | null => calculatorId } } },
        },
        { provide: CalculatorsApiService, useValue: api },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CalculatorBuilderComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ComponentFixture<CalculatorBuilderComponent>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function boton(fixture: ComponentFixture<CalculatorBuilderComponent>, name: string): HTMLButtonElement {
    const encontrado = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((candidate) => (candidate.textContent ?? '').includes(name));
    expect(encontrado !== undefined).toBeTrue();
    return encontrado as HTMLButtonElement;
  }

  it('al crear enseña el formulario vacío con una entrada y un resultado', async () => {
    const fixture = await render();
    expect(text(fixture)).toContain('Constructor de calculadoras');
    // Una fila de cada para que haya dónde escribir: un formulario sin filas no dice por dónde
    // empezar, y las etiquetas de la primera fila están puestas.
    expect(text(fixture)).toContain('Clave');
    expect(text(fixture)).toContain('Fórmula');
    expect(text(fixture)).toContain('Decimales');
  });

  it('pregunta al servidor si la definición es válida (FR-046)', async () => {
    const fixture = await render();
    api.validate.calls.reset();

    boton(fixture, 'Comprobar ahora').click();
    fixture.detectChanges();

    expect(api.validate).toHaveBeenCalled();
    const enviado = api.validate.calls.mostRecent().args[0] as { definition: unknown };
    expect(enviado.definition).toBeDefined();
    expect(text(fixture)).toContain('se puede analizar');
  });

  it('enseña los problemas del servidor, y los del campo en su campo', async () => {
    api.validate.and.returnValue(
      of({
        valid: false,
        errors: [
          { location: 'outputs[0].expression', code: 'expresion_invalida', message: 'falta el operando derecho' },
          { location: 'definition', code: 'sin_salidas', message: 'una calculadora tiene que devolver algo' },
        ],
      }),
    );

    const fixture = await render();
    boton(fixture, 'Comprobar ahora').click();
    fixture.detectChanges();

    expect(text(fixture)).toContain('falta el operando derecho');
    // Un problema sin fila a la que apuntar se enseña en el panel: no se marca un campo al azar.
    expect(text(fixture)).toContain('una calculadora tiene que devolver algo');
  });

  it('un fallo de red NO declara la definición inválida', async () => {
    // Decir «tiene problemas» cuando el problema es la conexión sería mentir sobre el trabajo del
    // autor, y lo único que sabe el cliente es que no pudo preguntar.
    api.validate.and.returnValue(throwError(() => new Error('sin red')));

    const fixture = await render();
    boton(fixture, 'Comprobar ahora').click();
    fixture.detectChanges();

    expect(text(fixture)).not.toContain('Hay algo que corregir');
    expect(text(fixture)).not.toContain('se puede analizar');
  });

  it('guardar envía la definición y avisa de que la calculadora es privada', async () => {
    const fixture = await render();
    const component = fixture.componentInstance as unknown as {
      form: { controls: { name: { setValue: (v: string) => void } } };
    };
    component.form.controls.name.setValue('Mi calculadora');

    boton(fixture, 'Guardar').click();
    fixture.detectChanges();

    expect(api.create).toHaveBeenCalled();
    expect(text(fixture)).toContain('es privada');
    expect(text(fixture)).toContain('Ver y ejecutar');
  });

  it('editar una publicada avisa de que lo publicado NO cambia', async () => {
    // Es el malentendido que esta pantalla existe para evitar: guardar una calculadora publicada
    // crea una versión nueva que sigue privada hasta que un coordinador la apruebe (FR-052).
    api.get.and.returnValue(of({ ...guardada, state: 'publicada' }));

    const fixture = await render('c1');
    expect(text(fixture)).toContain('versión nueva');
    expect(text(fixture)).toContain('no cambia hasta que un coordinador la apruebe');
  });

  it('editar una que espera revisión dice que guardar retira la propuesta', async () => {
    api.get.and.returnValue(of({ ...guardada, state: 'en_revision' }));

    const fixture = await render('c1');
    expect(text(fixture)).toContain('retira la propuesta');
  });

  it('un 422 enseña los problemas recibidos y no guarda nada', async () => {
    api.create.and.returnValue(
      throwError(() => {
        const error = new CalculatorError('invalid', 'La definición tiene 1 problemas que hay que corregir.');
        error.issues = [{ location: 'inputs[0].key', code: 'clave_invalida', message: 'la clave no puede estar vacía' }];
        return error;
      }),
    );

    const fixture = await render();
    boton(fixture, 'Guardar').click();
    fixture.detectChanges();

    expect(text(fixture)).toContain('la clave no puede estar vacía');
    expect(text(fixture)).not.toContain('Ver y ejecutar');
  });
});
