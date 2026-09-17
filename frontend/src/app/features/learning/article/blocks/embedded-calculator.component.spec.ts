import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { CalculatorError, CalculatorsApiService } from '../../../calculators/calculators-api.service';
import type { Calculator } from '../../../calculators/calculator.types';

import { EmbeddedCalculatorComponent } from './embedded-calculator.component';

/**
 * El bloque de calculadora incrustada (T153–T155, FR-071/FR-072).
 *
 * Lo que se prueba aquí es la DECISIÓN del bloque ante lo que contesta el borde, que son cuatro
 * casos y ninguno es un detalle:
 *
 *   1. la calculadora está y se pinta el ejecutor —el mismo que usa el simulador, así que la
 *      ejecución pasa por el Orquestador y queda en el historial—;
 *   2. la calculadora **ya no está publicada** ⇒ un aviso en su lugar, y el artículo se sigue
 *      leyendo (FR-072);
 *   3. la petición **falló** ⇒ un error con reintento, porque «ya no está publicada» y «no pudimos
 *      preguntar» exigen acciones distintas;
 *   4. y si la calculadora se corrigió después, se dice con qué versión se calculó.
 *
 * El caso 2 y el 3 se parecen en la pantalla y son la diferencia que más importa: decirle a quien
 * lee que la calculadora desapareció cuando lo único que pasó es que se cayó la red es mentirle
 * sobre el contenido del artículo.
 */
class ApiFalsa {
  public readonly pedidas: string[] = [];
  public respuesta: Calculator | null = null;
  public falla: CalculatorError | null = null;

  public get(calculatorId: string): Observable<Calculator> {
    this.pedidas.push(calculatorId);
    if (this.falla !== null) {
      return throwError(() => this.falla);
    }
    if (this.respuesta === null) {
      return throwError(() => new CalculatorError('notFound', 'no está'));
    }
    return of(this.respuesta);
  }

  /** Los valores que el usuario mandó a ejecutar, para comprobar que no se calcula aquí. */
  public readonly ejecuciones: { calculatorId: string; inputs: Record<string, string> }[] = [];

  public run(calculatorId: string, inputs: Record<string, string>): Observable<unknown> {
    this.ejecuciones.push({ calculatorId, inputs });
    return of({ simulation_id: 'sim-1', result: { doble: '40.00' }, calculator_version: 3 });
  }
}

function calculadora(version = 3): Calculator {
  return {
    calculator_id: 'calc-1',
    owner_id: '',
    name: 'Doble del monto',
    description: 'Devuelve el doble.',
    is_builtin: false,
    state: 'publicada',
    approved_by: '',
    rejection_reason: '',
    version,
    indicators_used: [],
    definition: {
      inputs: [
        {
          key: 'monto',
          label: 'Monto a invertir',
          type: 'monto',
          unit: 'COP',
          required: true,
          min_value: '0',
          max_value: '1000',
          default_value: '10',
        },
      ],
      validations: [],
      outputs: [{ key: 'doble', label: 'Doble del monto', expression: 'monto * 2', scale: 2 }],
    },
  };
}

describe('fc-embedded-calculator', () => {
  let api: ApiFalsa;

  beforeEach(async () => {
    api = new ApiFalsa();
    await TestBed.configureTestingModule({
      imports: [EmbeddedCalculatorComponent],
      // El ejecutor que se monta dentro navega por ruta (lee `ActivatedRoute` para saber qué
      // calculadora ejecutar cuando se usa como pantalla); aquí se usa con la definición ya
      // cargada, pero el inyector tiene que poder resolverla de todos modos.
      providers: [provideRouter([]), { provide: CalculatorsApiService, useValue: api }],
    }).compileComponents();
  });

  /**
   * Monta el bloque con la respuesta ya preparada.
   *
   * La respuesta se prepara ANTES de crear el componente a propósito: el bloque pide la
   * definición al crearse, así que un doble configurado después llegaría tarde y la prueba
   * comprobaría el estado de carga en lugar del que quiere comprobar.
   */
  function montar(opciones: {
    id?: string;
    pinned?: number | null;
    respuesta?: Calculator;
    falla?: CalculatorError;
  }): HTMLElement {
    if (opciones.respuesta !== undefined) {
      api.respuesta = opciones.respuesta;
    }
    if (opciones.falla !== undefined) {
      api.falla = opciones.falla;
    }
    const fixture = TestBed.createComponent(EmbeddedCalculatorComponent);
    fixture.componentRef.setInput('calculatorId', opciones.id ?? 'calc-1');
    fixture.componentRef.setInput('pinnedVersion', opciones.pinned ?? null);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('pide la definición por el identificador del documento', () => {
    montar({ id: 'calc-9', respuesta: calculadora() });

    expect(api.pedidas).toEqual(['calc-9']);
  });

  it('con la calculadora publicada, monta el ejecutor del simulador', () => {
    const host = montar({ respuesta: calculadora() });

    // El formulario sale de la DEFINICIÓN, con la etiqueta que escribió el autor: es la misma
    // pieza que la pantalla del simulador, así que la ejecución va por la misma ruta y queda en
    // el historial (FR-071) sin que este bloque sepa cómo se calcula nada.
    expect(host.textContent).toContain('Doble del monto');
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).toContain('Monto a invertir');
    // Y NO se enseña el estado ni la ayuda de estados: eso es información de quien administra
    // calculadoras, no de quien está leyendo un artículo.
    expect(host.textContent).not.toContain('Solo la ves tú');
  });

  it('si ya no está publicada, avisa en su lugar y no rompe nada más (FR-072)', () => {
    // Sin respuesta preparada, el doble contesta `notFound`: es lo que devuelve el Simulador
    // tanto para «no existe» como para «existe y no la puedes ver».
    const host = montar({});

    expect(host.textContent).toContain('ya no está publicada');
    expect(host.querySelector('form')).toBeNull();
  });

  it('un fallo de red NO se cuenta como «ya no está publicada»', () => {
    const host = montar({ falla: new CalculatorError('offline', 'sin conexión') });

    expect(host.textContent).toContain('No pudimos cargar la calculadora');
    // Es la diferencia que importa: la primera frase manda a dejar de intentarlo, la segunda a
    // reintentar. Y enseñar la primera cuando falló la red es afirmar algo falso del artículo.
    expect(host.textContent).not.toContain('ya no está publicada');
  });

  it('un error del servidor tampoco', () => {
    const host = montar({ falla: new CalculatorError('server', 'vaya') });

    expect(host.textContent).toContain('No pudimos cargar');
    expect(host.textContent).not.toContain('ya no está publicada');
  });

  it('si la calculadora se corrigió después, dice con qué versión se calcula', () => {
    // El artículo se escribió contra la versión 2 y el catálogo sirve la 4.
    const host = montar({ respuesta: calculadora(4), pinned: 2 });

    expect(host.textContent).toContain('se escribió con la versión 2');
    expect(host.textContent).toContain('la 4, que es la publicada ahora');
  });

  it('y no dice nada cuando coinciden', () => {
    // Un aviso que aparece siempre deja de leerse. Este solo aparece cuando hay algo que decir.
    const host = montar({ respuesta: calculadora(3), pinned: 3 });

    expect(host.textContent).not.toContain('se escribió con la versión');
  });
});
