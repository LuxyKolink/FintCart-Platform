import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ProfileService } from '../../profile/profile.service';
import { ProgressApiService } from './progress-api.service';
import { ProgressComponent } from './progress.component';

/**
 * T035/T040 y la restricción que impone la suite de extremo a extremo.
 *
 * `us1-aprendizaje.spec.ts` cierra con `expect(page.locator('.fc-num')).toHaveText(/\d+
 * puntos/)` y esa aserción resuelve contra UN elemento (verificado: con dos coincidencias
 * Playwright falla por ambigüedad). La suite no se toca (N-13), así que la pantalla tiene
 * que seguir teniendo exactamente un `.fc-num` cuyo texto incluya «puntos». La primera
 * prueba de abajo es la que impide que un rediseño futuro lo rompa en silencio: basta con
 * pedirle `showValue` a `fc-progress-bar` o marcar una estadística con la tipografía de
 * datos para que salte.
 */
describe('ProgressComponent', () => {
  let api: { getProgress: jasmine.Spy };
  let profile: { getActivityReport: jasmine.Spy; getPersonalData: jasmine.Spy };

  beforeEach(async () => {
    api = { getProgress: jasmine.createSpy('getProgress').and.returnValue(of({ user_id: 'u1', points: 240 })) };
    profile = {
      getActivityReport: jasmine.createSpy('getActivityReport').and.returnValue(
        of({ user_id: 'u1', points: 240, articles_viewed: 7, quizzes_attempted: 3, simulations_run: 2 }),
      ),
      getPersonalData: jasmine.createSpy('getPersonalData').and.returnValue(
        of({
          profile: {},
          progress: { user_id: 'u1', points: 240 },
          quiz_attempts: { items: [], total_size: 0 },
          simulations: { items: [], total_size: 0 },
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [ProgressComponent],
      providers: [
        provideRouter([]),
        { provide: ProgressApiService, useValue: api },
        { provide: ProfileService, useValue: profile },
      ],
    }).compileComponents();
  });

  function render(): ComponentFixture<ProgressComponent> {
    const fixture = TestBed.createComponent(ProgressComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('exposes exactly one .fc-num, and it reads «N puntos»', () => {
    const host = render().nativeElement as HTMLElement;
    const figures = host.querySelectorAll('.fc-num');

    expect(figures.length).toBe(1);
    expect(figures[0].textContent?.trim()).toBe('240 puntos');
  });

  it('shows the milestone the user is walking through', () => {
    const host = render().nativeElement as HTMLElement;

    expect(host.textContent).toContain('40 de 100 hacia los 300');
    expect(host.textContent).toContain('hito actual desde los 200');
  });

  it('shows a meaningful empty state when there are no attempts yet', () => {
    const host = render().nativeElement as HTMLElement;

    expect(host.textContent).toContain('Todavía no has resuelto ningún cuestionario');
  });

  it('renders the attempt score without truncating its decimals', () => {
    profile.getPersonalData.and.returnValue(
      of({
        profile: {},
        progress: { user_id: 'u1', points: 240 },
        quiz_attempts: {
          items: [
            { attempt_id: 't1', attempt_no: 1, score: '66,67', created_at: '2026-06-12T10:00:00Z' },
            { attempt_id: 't2', attempt_no: 2, score: '100.00', created_at: '2026-06-13T10:00:00Z' },
          ],
          total_size: 2,
        },
        simulations: { items: [], total_size: 0 },
      }),
    );
    const host = render().nativeElement as HTMLElement;

    // FR-109 / Principio VIII: 66.67 NO se convierte en 66 ni en 67.
    expect(host.textContent).toContain('66,67');
    expect(host.textContent).toContain('100');
    // El más reciente va primero.
    const rows = Array.from(host.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Intento n.º 2');
  });

  it('survives a failing statistics request without losing the points', () => {
    profile.getActivityReport.and.returnValue(throwError(() => new Error('boom')));
    const host = render().nativeElement as HTMLElement;

    expect(host.textContent).toContain('No pudimos cargar tus estadísticas');
    expect(host.querySelector('.fc-num')?.textContent?.trim()).toBe('240 puntos');
  });
});
