import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { SimulatorFormComponent } from './forms/simulator-form.component';
import { ResultComponent } from './result/result.component';
import { SimulationError, SimulatorsService } from './simulators.service';

/** El componente guarda el formulario en un `signal` protegido; la prueba lo alcanza. */
interface FormInternals {
  form(): FormGroup;
  onSubmit(): void;
}

/**
 * T051 / FR-118: cada lectura declara su estado por separado. Que el riel de últimas
 * simulaciones falle **no puede** impedir calcular: el usuario vino a calcular.
 */
describe('SimulatorFormComponent', () => {
  let api: { run: jasmine.Spy; listHistory: jasmine.Spy; currentIndicators: jasmine.Spy };

  beforeEach(() => {
    api = {
      run: jasmine.createSpy('run').and.returnValue(of({ simulation_id: 's1', result: {} })),
      listHistory: jasmine.createSpy('listHistory').and.returnValue(of({ items: [], total_size: 0 })),
      // Por defecto, todo en vigencia: el aviso de FR-062 solo aparece cuando el
      // servidor dice que falta algo, y eso lo fijan las pruebas que lo comprueban.
      currentIndicators: jasmine
        .createSpy('currentIndicators')
        .and.returnValue(of({ indicators: [], missing_names: [] })),
    };
  });

  async function render(calcType: string): Promise<ComponentFixture<SimulatorFormComponent>> {
    await TestBed.configureTestingModule({
      imports: [SimulatorFormComponent],
      providers: [
        provideRouter([]),
        { provide: SimulatorsService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (): string => calcType } } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SimulatorFormComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a comprehensible state when the calculator does not exist', async () => {
    const host = (await render('inexistente')).nativeElement as HTMLElement;

    expect(host.textContent).toContain('Esa calculadora no existe');
    // No hay nada que reintentar: la salida es volver al selector, y va como enlace.
    expect(host.querySelector('a[href="/simuladores"]')).not.toBeNull();
  });

  it('does not let a failing history panel take the form down with it', async () => {
    api.listHistory.and.returnValue(throwError(() => new Error('boom')));
    const host = (await render('credito')).nativeElement as HTMLElement;

    expect(host.textContent).toContain('No pudimos cargar tus últimas simulaciones');
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).toContain('Calcular');
  });

  it('shows the empty state of the history panel for a user who has not simulated yet', async () => {
    const host = (await render('credito')).nativeElement as HTMLElement;

    expect(host.textContent).toContain('Todavía no has guardado ninguna simulación');
  });

  it('advierte de que el resultado puede estar desactualizado cuando falta la vigencia (FR-062)', async () => {
    api.currentIndicators.and.returnValue(
      of({ indicators: [], missing_names: ['UVT', 'IPC'] }),
    );
    // El fixture se conserva: cambiar de modo se hace con un clic, y un clic necesita
    // volver a detectar cambios.
    const fixture = await render('colombia_especifica');
    const host = fixture.nativeElement as HTMLElement;

    // El GMF es el único modo que depende de `@UVT`; el modo por defecto de esta
    // calculadora es la conversión de tasas, que no usa indicadores. Eso es justo lo que
    // se comprueba primero: que el aviso es del MODO y no de la calculadora.
    expect(host.textContent).not.toContain('pueden estar desactualizados');

    const botonGmf = Array.from(host.querySelectorAll('button')).find((boton) =>
      (boton.textContent ?? '').includes('Gravamen'),
    );
    expect(botonGmf).toBeDefined();
    botonGmf?.click();
    fixture.detectChanges();

    expect(host.textContent).toContain('pueden estar desactualizados');
    expect(host.textContent).toContain('UVT');
    // Del IPC no se avisa aquí: no lo usa este modo. Un aviso que mencionara todos los
    // indicadores sin vigencia dejaría de ser un aviso para esta pantalla.
    expect(host.querySelector('fc-banner[data-tone="warning"]')?.textContent).not.toContain('IPC');
  });

  it('no advierte cuando la vigencia está al día', async () => {
    api.currentIndicators.and.returnValue(of({ indicators: [], missing_names: [] }));
    const host = (await render('colombia_especifica')).nativeElement as HTMLElement;

    expect(host.textContent).not.toContain('pueden estar desactualizados');
  });

  it('que falle la consulta de indicadores no impide calcular (FR-062)', async () => {
    api.currentIndicators.and.returnValue(throwError(() => new Error('boom')));
    const host = (await render('credito')).nativeElement as HTMLElement;

    // Sin el dato no hay aviso, pero tampoco un error: el usuario vino a calcular y la
    // advertencia solo matiza el resultado.
    expect(host.textContent).not.toContain('pueden estar desactualizados');
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).toContain('Calcular');
  });

  it('lets the rail reach all five calculators from the form', async () => {
    const host = (await render('credito')).nativeElement as HTMLElement;
    const links = Array.from(host.querySelectorAll('fc-calculator-rail a')).map((a) =>
      (a.textContent ?? '').trim(),
    );

    // FR-107: el riel acompaña al formulario de la calculadora elegida.
    expect(links).toContain('Crédito');
    expect(links).toContain('Ahorro');
    expect(links.length).toBe(5);
  });

  it('marks the current calculator as the current page', async () => {
    const host = (await render('credito')).nativeElement as HTMLElement;

    expect(host.querySelector('fc-calculator-rail [aria-current="page"]')?.textContent?.trim()).toBe(
      'Crédito',
    );
  });

  it('shows the raw decimal result through the formatter, not as a canonical string', async () => {
    api.run.and.returnValue(
      of({ simulation_id: 's1', result: { cuota_mensual: '568900.5', tasa_mensual: '0.01989' } }),
    );
    const fixture = await render('credito');
    const internals = fixture.componentInstance as unknown as FormInternals;
    internals.form().setValue({ monto: '10000000', tasa_anual: '0.24', meses: '12' });
    internals.onSubmit();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('$568.900,50');
    expect(api.run).toHaveBeenCalled();
  });

  it('explains a connection failure without clearing the form', async () => {
    api.run.and.returnValue(
      throwError(() => new SimulationError('offline', 'Parece que perdiste la conexión.')),
    );
    const fixture = await render('credito');
    const internals = fixture.componentInstance as unknown as FormInternals;
    internals.form().setValue({ monto: '10000000', tasa_anual: '0.24', meses: '12' });
    internals.onSubmit();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Parece que perdiste la conexión');
    // Los valores escritos siguen ahí: el usuario no tiene que volver a teclearlos.
    expect(internals.form().get('monto')?.value).toBe('10000000');
  });
});

/** El resultado se prueba aparte: es presentación pura sobre la configuración de campos. */
describe('ResultComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ResultComponent] }).compileComponents();
  });

  it('formats money and rates and never shows a raw canonical string', () => {
    const fixture = TestBed.createComponent(ResultComponent);
    fixture.componentRef.setInput('fields', [
      { key: 'cuota_mensual', label: 'Cuota mensual', kind: 'money' },
      { key: 'tasa_mensual', label: 'Tasa mensual equivalente', kind: 'rate' },
    ]);
    fixture.componentRef.setInput('result', { cuota_mensual: '1234567.89', tasa_mensual: '0.01989' });
    fixture.detectChanges();

    const values = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('dd')).map((dd) =>
      (dd.textContent ?? '').trim(),
    );
    expect(values[0]).toBe('$1.234.567,89');
    expect(values[1]).toBe('1,989 %');
  });

  it('omits an optional field that the simulation did not return', () => {
    const fixture = TestBed.createComponent(ResultComponent);
    fixture.componentRef.setInput('fields', [
      { key: 'valor_futuro', label: 'Valor futuro', kind: 'money' },
      { key: 'valor_futuro_real', label: 'Valor futuro real', kind: 'money', optional: true },
    ]);
    fixture.componentRef.setInput('result', { valor_futuro: '100.00' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Valor futuro real');
  });

  it('keeps the principal figure first, so the money amount is the headline', () => {
    const fixture = TestBed.createComponent(ResultComponent);
    fixture.componentRef.setInput('fields', [
      { key: 'cuota_mensual', label: 'Cuota mensual', kind: 'money' },
      { key: 'total_pagado', label: 'Total pagado', kind: 'money' },
    ]);
    fixture.componentRef.setInput('result', { cuota_mensual: '100.00', total_pagado: '1200.00' });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // `us2-simuladores.spec.ts` afirma que el PRIMER `dd.fc-num` lleva el símbolo del peso.
    const first = host.querySelector('dd.fc-num');
    expect(first?.textContent).toContain('$');
    expect(host.querySelector('.fc-result__row--primary dt')?.textContent).toContain('Cuota mensual');
  });
});
