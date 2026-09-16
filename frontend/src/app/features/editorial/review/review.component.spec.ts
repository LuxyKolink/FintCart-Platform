import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { EditorialApiService, EditorialError } from '../editorial-api.service';
import { ArticleVersion } from '../editorial.types';
import { ReviewComponent } from './review.component';

/**
 * T066/T067/T071: la decisión de aprobar o rechazar se presenta con sus dos salidas
 * (FR-115), el aviso de FR-116 aparece cuando el borde rechaza la auto-aprobación **sin
 * duplicar la regla en la vista**, y la bandeja declara sus estados.
 */
describe('ReviewComponent', () => {
  let api: { listVersions: jasmine.Spy; approveAndPublish: jasmine.Spy; archive: jasmine.Spy };
  let auth: { userId: jasmine.Spy };

  const version: ArticleVersion = {
    version_id: 'v1',
    article_id: 'a1',
    version_no: 1,
    state: 'en_revision',
    created_by: 'otro-uuid',
    created_at: '2026-06-12T10:00:00Z',
    body: 'Cuerpo del artículo de prueba, con suficiente longitud.',
  };

  beforeEach(() => {
    api = {
      listVersions: jasmine.createSpy('listVersions').and.returnValue(of({ items: [version], total_size: 1 })),
      approveAndPublish: jasmine.createSpy('approveAndPublish').and.returnValue(of({ ok: true })),
      // `archive` sigue en la API —archiva versiones PUBLICADAS— y por eso se declara: si
      // la pantalla volviera a llamarlo sobre una versión en revisión, la prueba lo vería.
      archive: jasmine.createSpy('archive').and.returnValue(of({ ok: true })),
    };
    auth = { userId: jasmine.createSpy('userId').and.returnValue('yo') };
  });

  async function render(): Promise<ComponentFixture<ReviewComponent>> {
    await TestBed.configureTestingModule({
      imports: [ReviewComponent],
      providers: [
        provideRouter([]),
        { provide: EditorialApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ReviewComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('asks the server only for what is pending review', async () => {
    await render();
    expect(api.listVersions).toHaveBeenCalledWith({ state: 'en_revision' });
  });

  /**
   * FR-115 pide la decisión de aprobar **o rechazar**, y la segunda mitad no existe en el
   * servicio: no hay transición que saque una versión de `en_revision` salvo publicarla. La
   * prueba fija lo que la pantalla hace de verdad —una sola acción— para que nadie vuelva a
   * añadir un «rechazar» que el borde responde con `FailedPrecondition`. Se descubrió
   * pulsándolo contra el servicio real; esta prueba no lo habría detectado nunca, y por eso
   * el comentario: aquí solo se garantiza que la vista no prometa lo que no hay.
   */
  it('offers the only decision the service can carry out, and does not promise another', async () => {
    const host = (await render()).nativeElement as HTMLElement;
    const actions = Array.from(host.querySelectorAll('.fc-rev__decision button')).map((b) =>
      (b.textContent ?? '').trim(),
    );

    expect(actions).toEqual(['Aprobar y publicar']);
  });

  it('keeps the preview, which is what lets a coordinator decide without opening the editor', async () => {
    const host = (await render()).nativeElement as HTMLElement;

    // `us4-editorial.spec.ts` identifica la versión justamente por este texto.
    expect(host.querySelector('.fc-rev__preview')?.textContent).toContain('Cuerpo del artículo de prueba');
    // Y el elemento es un `<article>` único por versión (la suite lo busca por etiqueta).
    expect(host.querySelectorAll('article').length).toBe(1);
  });

  it('takes the version out of the queue after publishing', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    (host.querySelector('.fc-rev__decision button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api.approveAndPublish).toHaveBeenCalledWith('v1');
    expect(api.archive).not.toHaveBeenCalled();
    expect(host.textContent).toContain('No hay nada pendiente de revisión');
  });

  it('explains the self-approval block as a rule, not as a generic error', async () => {
    api.approveAndPublish.and.returnValue(
      throwError(
        () =>
          new EditorialError(
            'forbidden',
            'Un coordinador editorial no puede aprobar ni publicar su propio artículo.',
          ),
      ),
    );
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    (host.querySelector('.fc-rev__decision button') as HTMLButtonElement).click();
    fixture.detectChanges();

    // FR-116: el aviso es propio y explica la regla; la regla misma la sigue decidiendo el
    // borde, la vista solo la cuenta.
    expect(host.textContent).toContain('No puedes aprobar tu propio contenido');
    expect(host.textContent).toContain('Pídeselo a otro coordinador editorial');
    // Y la versión SIGUE en la cola: no se publicó ni se archivó.
    expect(host.textContent).toContain('Aprobar y publicar');
  });

  it('shows a generic error for anything that is not the self-approval block', async () => {
    api.approveAndPublish.and.returnValue(
      throwError(() => new EditorialError('offline', 'Parece que perdiste la conexión.')),
    );
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    (host.querySelector('.fc-rev__decision button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.textContent).toContain('Parece que perdiste la conexión');
    expect(host.textContent).not.toContain('No puedes aprobar tu propio contenido');
  });

  it('shows a meaningful empty state when nobody has sent anything', async () => {
    api.listVersions.and.returnValue(of({ items: [], total_size: 0 }));
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('No hay nada pendiente de revisión');
  });

  it('shows an error state with retry, and retries on demand', async () => {
    api.listVersions.and.returnValue(throwError(() => new Error('boom')));
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('No pudimos cargar la bandeja de revisión');

    api.listVersions.and.returnValue(of({ items: [version], total_size: 1 }));
    (host.querySelector('fc-error-state button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.textContent).toContain('Aprobar y publicar');
  });
});
