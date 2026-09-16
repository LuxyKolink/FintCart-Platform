import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ProfileService } from '../profile.service';
import { ActivityReport } from '../profile.types';
import { ReportComponent } from './report.component';

/**
 * T058 / FR-113: las cifras del reporte se muestran TAL COMO llegan y con la tipografía de
 * datos.
 *
 * Las cuatro son conteos enteros (FR-014/FR-018), así que no cruzan ninguna frontera decimal
 * y el Principio VIII no tiene nada que preservar aquí más allá de no manipularlas: estas
 * pruebas fijan que el componente no suma, no promedia, no redondea y no formatea — solo
 * pinta el número que recibió, incluso cuando es grande.
 */
describe('ReportComponent', () => {
  let api: { getActivityReport: jasmine.Spy };

  const report: ActivityReport = {
    user_id: 'u1',
    points: 240,
    articles_viewed: 7,
    quizzes_attempted: 3,
    simulations_run: 2,
  };

  beforeEach(() => {
    api = { getActivityReport: jasmine.createSpy('getActivityReport').and.returnValue(of(report)) };
  });

  async function render(): Promise<ComponentFixture<ReportComponent>> {
    await TestBed.configureTestingModule({
      imports: [ReportComponent],
      providers: [provideRouter([]), { provide: ProfileService, useValue: api }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReportComponent);
    fixture.detectChanges();
    return fixture;
  }

  function figures(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll('.fc-num')).map((el) => (el.textContent ?? '').trim());
  }

  it('labels the four figures with the exact contract wording', async () => {
    const host = (await render()).nativeElement as HTMLElement;

    // `us3-perfil.spec.ts` busca estos cuatro textos: si uno cambia de redacción, la
    // aserción deja de encontrarlo.
    expect(host.textContent).toContain('Puntos acumulados');
    expect(host.textContent).toContain('Artículos vistos');
    expect(host.textContent).toContain('Cuestionarios respondidos');
    expect(host.textContent).toContain('Simulaciones ejecutadas');
  });

  it('renders every figure with the data typography and without touching the value', async () => {
    const host = (await render()).nativeElement as HTMLElement;

    expect(figures(host)).toEqual(['240', '7', '3', '2']);
  });

  it('does not lose a large count', async () => {
    api.getActivityReport.and.returnValue(
      of({ ...report, articles_viewed: 9_007_199_254_740_991 }),
    );
    const host = (await render()).nativeElement as HTMLElement;

    // El mayor entero exacto de un `double`. Un conteo así no es realista, pero si algún
    // día el componente formateara o redondeara, se vería aquí.
    expect(figures(host)[1]).toBe('9007199254740991');
  });

  it('explains a report full of zeros instead of showing four bare numbers', async () => {
    api.getActivityReport.and.returnValue(
      of({ ...report, points: 0, articles_viewed: 0, quizzes_attempted: 0, simulations_run: 0 }),
    );
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('Todavía no registras actividad');
    // Y las cuatro cifras siguen visibles: el estado vacío acompaña, no sustituye.
    expect(figures(host)).toEqual(['0', '0', '0', '0']);
  });

  it('shows an error state with retry, and retries on demand', async () => {
    api.getActivityReport.and.returnValue(throwError(() => new Error('boom')));
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('No pudimos cargar tu reporte');

    api.getActivityReport.and.returnValue(of(report));
    (host.querySelector('fc-error-state button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(figures(host)).toEqual(['240', '7', '3', '2']);
  });
});
