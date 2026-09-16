import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { SimulatorsService } from '../simulators.service';
import { SimulationHistoryEntry } from '../simulators.types';
import { HistoryComponent } from './history.component';

/**
 * T047/T051: el historial se puede **comparar** sin abrir ninguna entrada (FR-110) y
 * declara sus estados de carga, error y vacío (FR-118/FR-119).
 *
 * La entrada de `credito` se escribe con la forma real del contrato: `inputs` y `result`
 * son mapas de cadenas decimales canónicas, nunca números.
 */
describe('HistoryComponent', () => {
  let api: { listHistory: jasmine.Spy };

  const entry: SimulationHistoryEntry = {
    simulation_id: 's1',
    calc_type: 'credito',
    currency: 'COP',
    inputs: { monto: '10000000', tasa_anual: '0.24', meses: '12' },
    result: { cuota_mensual: '945596.34', total_pagado: '11347156.08', tasa_mensual: '0.018087' },
    created_at: '2026-06-12T10:00:00Z',
  };

  beforeEach(() => {
    api = {
      listHistory: jasmine.createSpy('listHistory').and.returnValue(of({ items: [entry], total_size: 1 })),
    };
  });

  async function render(): Promise<ComponentFixture<HistoryComponent>> {
    await TestBed.configureTestingModule({
      imports: [HistoryComponent],
      providers: [provideRouter([]), { provide: SimulatorsService, useValue: api }],
    }).compileComponents();

    const fixture = TestBed.createComponent(HistoryComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows each simulation with its parameters and its result in the same row', async () => {
    const host = (await render()).nativeElement as HTMLElement;

    // FR-110: comparar es leer la misma columna, sin desplegar nada.
    const row = host.querySelector('tbody tr') as HTMLTableRowElement;
    expect(row.textContent).toContain('Crédito');
    expect(row.textContent).toContain('Monto del crédito');
    expect(row.textContent).toContain('$10,000,000.00');
    expect(row.textContent).toContain('Cuota mensual');
    expect(row.textContent).toContain('$945,596.34');
  });

  it('does not show the mode selector as if the user had typed it', async () => {
    api.listHistory.and.returnValue(
      of({
        items: [
          {
            ...entry,
            calc_type: 'colombia_especifica',
            inputs: { operacion: 'ea_a_mv', tasa_ea: '0.24' },
            result: { tasa_mv: '0.018087' },
          },
        ],
        total_size: 1,
      }),
    );
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('Tasa Efectiva Anual');
    expect(host.textContent).not.toContain('ea_a_mv');
  });

  it('renders the money amount complete, without a truncating style contract', async () => {
    const host = (await render()).nativeElement as HTMLElement;
    const values = Array.from(host.querySelectorAll('dd.fc-num')).map((dd) => (dd.textContent ?? '').trim());

    // N-15: la cifra no es texto incompleto. El valor completo está en el DOM.
    expect(values).toContain('$945,596.34');
  });

  it('offers a way out when there is nothing to compare', async () => {
    api.listHistory.and.returnValue(of({ items: [], total_size: 0 }));
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('Todavía no has ejecutado ninguna simulación');
    expect(host.querySelector('a[href="/simuladores"]')).not.toBeNull();
  });

  it('shows an error state with retry, and retries on demand', async () => {
    api.listHistory.and.returnValue(throwError(() => new Error('boom')));
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('No pudimos cargar tu historial');

    api.listHistory.and.returnValue(of({ items: [entry], total_size: 1 }));
    (host.querySelector('fc-error-state button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.textContent).toContain('Cuota mensual');
  });

  it('appends the next page instead of replacing what is already shown', async () => {
    const second: SimulationHistoryEntry = { ...entry, simulation_id: 's2' };
    api.listHistory.and.returnValue(of({ items: [entry], total_size: 2, next_page_token: 'p2' }));
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    api.listHistory.and.returnValue(of({ items: [second], total_size: 2 }));
    (host.querySelector('.fc-history__more button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.querySelectorAll('tbody tr').length).toBe(2);
  });
});
