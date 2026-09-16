import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { EditorialApiService } from '../editorial-api.service';
import { ArticleVersion } from '../editorial.types';
import { VersionsComponent } from './versions.component';

/**
 * T065/T068/T071: el listado de versiones distingue los estados (FR-114), presenta autor y
 * fechas de forma consistente (FR-117) y declara sus estados de carga, error y vacío.
 *
 * El autor es el punto delicado: el contrato solo lleva el IDENTIFICADOR del editor, así que
 * lo único afirmable sin inventar nada es si la versión es tuya. La prueba fija que no se
 * finge un nombre.
 */
describe('VersionsComponent', () => {
  let api: { listVersions: jasmine.Spy };
  let auth: { userId: jasmine.Spy };

  const version: ArticleVersion = {
    version_id: 'v1',
    article_id: 'a1',
    version_no: 3,
    state: 'borrador',
    created_by: 'yo',
    created_at: '2026-06-12T10:00:00Z',
    body: 'Cuerpo',
  };

  beforeEach(() => {
    api = { listVersions: jasmine.createSpy('listVersions').and.returnValue(of({ items: [version], total_size: 1 })) };
    auth = { userId: jasmine.createSpy('userId').and.returnValue('yo') };
  });

  async function render(articleId: string | null = null): Promise<ComponentFixture<VersionsComponent>> {
    await TestBed.configureTestingModule({
      imports: [VersionsComponent],
      providers: [
        provideRouter([]),
        { provide: EditorialApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: (): string | null => articleId } } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VersionsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('names the state of every version with its own badge', async () => {
    api.listVersions.and.returnValue(
      of({
        items: [
          version,
          { ...version, version_id: 'v2', state: 'en_revision' },
          { ...version, version_id: 'v3', state: 'publicado' },
          { ...version, version_id: 'v4', state: 'archivado' },
        ],
        total_size: 4,
      }),
    );
    const host = (await render()).nativeElement as HTMLElement;

    // FR-114: los cuatro estados se distinguen de un vistazo.
    expect(host.textContent).toContain('Borrador');
    expect(host.textContent).toContain('En revisión');
    expect(host.textContent).toContain('Publicado');
    expect(host.textContent).toContain('Archivado');
  });

  it('shows a state it does not know rather than inventing a label', async () => {
    api.listVersions.and.returnValue(of({ items: [{ ...version, state: 'pendiente_de_algo' as never }], total_size: 1 }));
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('pendiente_de_algo');
  });

  it('says «Tú» for your own versions and does not fake a name for the others', async () => {
    api.listVersions.and.returnValue(
      of({ items: [version, { ...version, version_id: 'v2', created_by: 'otro-uuid' }], total_size: 2 }),
    );
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('Tú');
    expect(host.textContent).toContain('Otro editor');
    // El identificador se conserva para poder trazar (T068), pero no se inventa un nombre.
    expect(host.textContent).toContain('otro-uuid');
  });

  it('offers «seguir editando» only for your own drafts', async () => {
    api.listVersions.and.returnValue(
      of({
        items: [
          version,
          { ...version, version_id: 'v2', created_by: 'otro-uuid' },
          { ...version, version_id: 'v3', state: 'publicado' },
        ],
        total_size: 3,
      }),
    );
    const host = (await render()).nativeElement as HTMLElement;

    // Una sola versión es borrador propio: de las otras, una es ajena y la otra está publicada.
    expect(host.querySelectorAll('a[href^="/editorial/versiones/"]').length).toBe(1);
  });

  it('asks the server for the article when the route brings one', async () => {
    await render('a1');
    expect(api.listVersions).toHaveBeenCalledWith({ article_id: 'a1' });
  });

  it('asks the server for the editor\u2019s own versions when there is no article', async () => {
    await render(null);
    expect(api.listVersions).toHaveBeenCalledWith({ editor_id: 'yo' });
  });

  it('shows a meaningful empty state and a way to start', async () => {
    api.listVersions.and.returnValue(of({ items: [], total_size: 0 }));
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('Todavía no hay versiones aquí');
    expect(host.querySelector('a[href="/editorial"]')).not.toBeNull();
  });

  it('shows an error state with retry, and retries on demand', async () => {
    api.listVersions.and.returnValue(throwError(() => new Error('boom')));
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('No pudimos cargar el historial');

    api.listVersions.and.returnValue(of({ items: [version], total_size: 1 }));
    (host.querySelector('fc-error-state button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.textContent).toContain('Borrador');
  });
});
