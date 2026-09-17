import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { CalculatorError, CalculatorsApiService } from '../../calculators/calculators-api.service';
import { Calculator } from '../../calculators/calculator.types';
import { ReviewCalculatorsComponent } from './review-calculators.component';

/**
 * Bandeja de curaduría de calculadoras (T117, FR-052…FR-054).
 *
 * Lo que fijan estas pruebas, y por qué:
 *
 *   · La bandeja pide SOLO lo que espera revisión y decide por el estado, no filtrando en el
 *     cliente.
 *   · **Un rechazo sin motivo no sale**: el motivo es lo que el autor necesita para corregir, y
 *     el formulario tiene que impedir el envío antes de llegar al servidor —que además lo
 *     rechazaría con su `CHECK`—.
 *   · El **403** de FR-053 se explica con un aviso propio y no con el error genérico: los datos
 *     no son el problema, y el mensaje dice quién puede aprobar.
 *   · La calculadora aprobada o rechazada SALE de la bandeja: ya no está pendiente.
 */
describe('ReviewCalculatorsComponent', () => {
  let api: { listForReview: jasmine.Spy; approve: jasmine.Spy; reject: jasmine.Spy };
  let auth: { userId: jasmine.Spy };

  const calculadora: Calculator = {
    calculator_id: 'c1',
    owner_id: 'otro-uuid',
    name: 'Cuota con interés',
    description: 'Calcula la cuota de un crédito',
    is_builtin: false,
    state: 'en_revision',
    version: 2,
    definition: {
      inputs: [{ key: 'monto', label: 'Monto', type: 'monto', unit: 'COP', required: true }],
      validations: [],
      outputs: [{ key: 'cuota', label: 'Cuota mensual', expression: 'monto * 2', scale: 2 }],
    },
    indicators_used: [],
  };

  beforeEach(() => {
    api = {
      listForReview: jasmine.createSpy('listForReview').and.returnValue(of({ items: [calculadora], total_size: 1 })),
      approve: jasmine.createSpy('approve').and.returnValue(of({ calculator_id: 'c1', version: 2 })),
      reject: jasmine.createSpy('reject').and.returnValue(of({ success: true })),
    };
    auth = { userId: jasmine.createSpy('userId').and.returnValue('yo') };
  });

  async function render(): Promise<ComponentFixture<ReviewCalculatorsComponent>> {
    await TestBed.configureTestingModule({
      imports: [ReviewCalculatorsComponent],
      providers: [
        provideRouter([]),
        { provide: CalculatorsApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReviewCalculatorsComponent);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ComponentFixture<ReviewCalculatorsComponent>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function botones(fixture: ComponentFixture<ReviewCalculatorsComponent>): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
  }

  async function pulsar(fixture: ComponentFixture<ReviewCalculatorsComponent>, name: string): Promise<void> {
    const boton = botones(fixture).find((b) => (b.textContent ?? '').includes(name));
    // Sin mensaje de contexto: Jasmine no lo admite en `expect`, y una expectativa propia
    // antes del `click` deja el mismo dato cuando el botón no está.
    expect(boton !== undefined).toBeTrue();
    boton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('pide solo lo que espera revisión', async () => {
    await render();
    expect(api.listForReview).toHaveBeenCalled();
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('enseña qué devuelve la calculadora antes de aprobarla', async () => {
    const fixture = await render();
    expect(text(fixture)).toContain('Cuota mensual');
    expect(text(fixture)).toContain('2 decimales');
  });

  it('aprobar publica y saca la calculadora de la bandeja', async () => {
    const fixture = await render();

    await pulsar(fixture, 'Aprobar y publicar');

    expect(api.approve).toHaveBeenCalledWith('c1');
    expect(text(fixture)).toContain('está publicada');
    // Ya no está pendiente: la bandeja deja de ofrecer la decisión.
    expect(botones(fixture).some((b) => (b.textContent ?? '').includes('Aprobar'))).toBeFalse();
  });

  it('un rechazo SIN motivo no se envía', async () => {
    const fixture = await render();

    await pulsar(fixture, 'Rechazar');
    await pulsar(fixture, 'Confirmar rechazo');

    expect(api.reject).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Escribe el motivo');
  });

  it('un rechazo CON motivo lo manda al servidor y sale de la bandeja', async () => {
    const fixture = await render();

    await pulsar(fixture, 'Rechazar');
    const campo = (fixture.nativeElement as HTMLElement).querySelector('input');
    expect(campo).toBeTruthy();
    if (campo !== null) {
      campo.value = 'falta explicar la tasa';
      campo.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();

    await pulsar(fixture, 'Confirmar rechazo');

    expect(api.reject).toHaveBeenCalledWith('c1', 'falta explicar la tasa');
    expect(text(fixture)).toContain('quedó rechazada');
  });

  it('el 403 de FR-053 se explica con un aviso propio', async () => {
    api.approve.and.returnValue(
      throwError(() => new CalculatorError('forbidden', 'Nadie aprueba su propia calculadora.')),
    );
    const fixture = await render();

    await pulsar(fixture, 'Aprobar y publicar');

    // El aviso propio de FR-053: dice quién puede aprobar y qué pasa con la propuesta, en
    // lugar de un «acceso denegado» que no explica nada.
    expect(text(fixture)).toContain('otra persona');
    expect(text(fixture)).toContain('Tu propuesta sigue esperando');
  });

  it('señala cuáles son tuyas sin esconderles el botón', async () => {
    api.listForReview.and.returnValue(of({ items: [{ ...calculadora, owner_id: 'yo' }], total_size: 1 }));
    const fixture = await render();

    expect(text(fixture)).toContain('Tuya');
    // El botón SIGUE ahí: la barrera vive en el servidor, y esconderlo aquí sugeriría que la
    // regla está en la interfaz.
    expect(botones(fixture).some((b) => (b.textContent ?? '').includes('Aprobar'))).toBeTrue();
  });

  it('sin nada pendiente lo dice, en lugar de dejar la pantalla vacía', async () => {
    api.listForReview.and.returnValue(of({ items: [], total_size: 0 }));
    const fixture = await render();

    expect(text(fixture)).toContain('No hay calculadoras esperando revisión');
  });
});
