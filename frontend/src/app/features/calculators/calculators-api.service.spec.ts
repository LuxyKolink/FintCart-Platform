import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CalculatorError, CalculatorsApiService } from './calculators-api.service';
import { CalculatorWriteBody } from './calculator.types';

/**
 * Clasificación de los errores de la curaduría y del constructor (T116–T119).
 *
 * ## Lo que fija esta prueba, y por qué se escribió
 *
 * Que el motivo de un 400 **llega al usuario**. El borde tenía aplanado todo 400 a «petición
 * inválida» y esta capa escribía además su propia frase, así que una ejecución rechazada por una
 * regla del autor —`monto > 1000`, con el mensaje «El monto tiene que superar 1000»— acababa
 * mostrando «La operación no se pudo completar en ese estado». FR-045 existe para poder explicar
 * por qué no se calcula, y la explicación se estaba perdiendo en dos sitios a la vez.
 *
 * La prueba usa los cuerpos EXACTOS que devolvió la pila de desarrollo, no unos inventados: un
 * cuerpo escrito a gusto de la prueba es lo que deja pasar este tipo de defecto.
 */
describe('CalculatorsApiService', () => {
  let api: CalculatorsApiService;
  let http: HttpTestingController;

  const cuerpo: CalculatorWriteBody = {
    name: 'Con regla',
    description: 'rechaza montos pequeños',
    definition: {
      inputs: [{ key: 'monto', label: 'Monto', type: 'monto', unit: 'COP', required: true }],
      validations: [{ expression: 'monto > 1000', message: 'El monto tiene que superar 1000' }],
      outputs: [{ key: 'salida', label: 'Salida', expression: 'monto * 2', scale: 2 }],
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CalculatorsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  /**
   * La URL se compone con `environment.apiBaseUrl` y no se escribe a mano.
   *
   * En las pruebas la base es `/v1` —la ruta relativa del despliegue de producción— y no
   * `http://localhost:8080`, que es solo el valor de desarrollo. Escribir el literal hacía que
   * estas pruebas no encontraran NINGUNA petición, y el fallo resultante hablaba de una URL que no
   * coincidía en lugar de lo que se estaba probando.
   */
  function url(path: string): string {
    return `${environment.apiBaseUrl}${path}`;
  }

  /**
   * Lanza la petición, responde con ese fallo y devuelve el error ya clasificado.
   *
   * El orden importa y no es cosmético: `HttpClient` entrega la respuesta cuando el backend de
   * pruebas la emite, así que comprobar el error ANTES de `flush` mira un valor que todavía no
   * existe. La primera versión de esta ayuda lo hacía así y las cinco pruebas fallaban con un
   * «expected null not to be null» que no decía nada del defecto que buscaban.
   */
  function fallo(
    peticion: Observable<unknown>,
    ruta: string,
    respuesta: { status: number; statusText: string; body?: unknown },
  ): CalculatorError {
    let capturado: CalculatorError | null = null;
    peticion.subscribe({
      error: (err: unknown) => {
        capturado = err as CalculatorError;
      },
    });

    http
      .expectOne(url(ruta))
      .flush(respuesta.body ?? null, { status: respuesta.status, statusText: respuesta.statusText });

    expect(capturado).not.toBeNull();
    return capturado as unknown as CalculatorError;
  }

  it('el 400 de una regla del autor conserva SU mensaje (FR-045)', () => {
    const error = fallo(api.run('c1', { monto: '500' }), '/calculators/c1/run', {
      status: 400,
      statusText: 'Bad Request',
      body: { code: 'bad_request', message: 'El monto tiene que superar 1000' },
    });

    expect(error.kind).toBe('invalid');
    expect(error.message).toBe('El monto tiene que superar 1000');
  });

  it('un 400 sin mensaje en el cuerpo no se queda sin explicación', () => {
    // El cuerpo vacío es el caso de una ruta que no es de calculadoras; el usuario tiene que leer
    // algo de todos modos.
    const error = fallo(api.submitForReview('c1'), '/calculators/c1/submit', {
      status: 400,
      statusText: 'Bad Request',
    });

    expect(error.kind).toBe('invalid');
    expect(error.message).not.toBe('');
  });

  it('un 422 lleva los problemas con su ubicación, para resaltar el campo (FR-046)', () => {
    const error = fallo(api.create(cuerpo), '/calculators', {
      status: 422,
      statusText: 'Unprocessable Entity',
      body: {
        code: 'definicion_invalida',
        message: 'la definición tiene problemas',
        errors: [{ location: 'outputs[0].expression', code: 'campo_inexistente', message: 'no existe «capital»' }],
      },
    });

    expect(error.issues.length).toBe(1);
    expect(error.issues[0].location).toBe('outputs[0].expression');
  });

  it('un 403 explica que nadie aprueba su propia calculadora (FR-053)', () => {
    const error = fallo(api.approve('c1'), '/editorial/calculators/c1/approve', {
      status: 403,
      statusText: 'Forbidden',
      body: { code: 'forbidden', message: 'acceso denegado' },
    });

    expect(error.kind).toBe('forbidden');
    expect(error.message).toContain('su propia calculadora');
  });

  it('sin conexión lo dice, en lugar de culpar a los datos', () => {
    let capturado: CalculatorError | null = null;
    api.listMine().subscribe({
      error: (err: unknown) => {
        capturado = err as CalculatorError;
      },
    });
    http
      .expectOne(url('/me/calculators'))
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    const error = capturado as unknown as CalculatorError;
    expect(error).not.toBeNull();
    expect(error.kind).toBe('offline');
    expect(error.message).toContain('conexión');
  });
});
