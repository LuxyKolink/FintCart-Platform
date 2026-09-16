import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ProfileService } from '../../profile/profile.service';
import { LearningApiService } from '../learning-api.service';
import { ProgressApiService } from '../progress/progress-api.service';
import { CatalogComponent } from './catalog.component';

/**
 * T037/T038 / FR-118/FR-119: los estados de carga, error y vacío del portal.
 *
 * Se prueban con dobles porque son justo los caminos que la pila real casi nunca
 * recorre: el catálogo de desarrollo SIEMPRE tiene artículos y SIEMPRE responde, así
 * que un `@if` mal puesto en el caso vacío no lo detectaría ni el recorrido de extremo a
 * extremo ni una revisión visual.
 */
describe('CatalogComponent', () => {
  let learning: {
    listArticles: jasmine.Spy;
    listCategories: jasmine.Spy;
  };
  let progress: { getProgress: jasmine.Spy };
  let profile: { listNotifications: jasmine.Spy };

  const article = {
    article_id: 'a1',
    title: 'Cómo construir tu primer presupuesto',
    category: 'Presupuesto',
    category_id: 'c1',
    body: '',
    current_version_no: 1,
    quiz_ids: [],
  };

  beforeEach(async () => {
    learning = {
      listArticles: jasmine.createSpy('listArticles').and.returnValue(of({ items: [], total_size: 0 })),
      listCategories: jasmine.createSpy('listCategories').and.returnValue(of([])),
    };
    progress = { getProgress: jasmine.createSpy('getProgress').and.returnValue(of({ user_id: 'u1', points: 40 })) };
    profile = {
      listNotifications: jasmine
        .createSpy('listNotifications')
        .and.returnValue(of({ items: [], total_size: 0 })),
    };

    await TestBed.configureTestingModule({
      imports: [CatalogComponent],
      providers: [
        provideRouter([]),
        { provide: LearningApiService, useValue: learning },
        { provide: ProgressApiService, useValue: progress },
        { provide: ProfileService, useValue: profile },
      ],
    }).compileComponents();
  });

  function render(): ComponentFixture<CatalogComponent> {
    const fixture = TestBed.createComponent(CatalogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a meaningful empty state when the catalog has nothing published', () => {
    const fixture = render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Aquí todavía no hay nada publicado');
    expect(text).toContain('No tienes notificaciones todavía');
  });

  it('shows an error state with a way out when the catalog request fails', () => {
    learning.listArticles.and.returnValue(throwError(() => new Error('boom')));
    const fixture = render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No pudimos cargar el catálogo');
    expect(text).toContain('Reintentar');
  });

  it('keeps the rails alive when only one of them fails', () => {
    // FR-118: cada zona declara su error por separado. Que la bandeja falle no puede
    // dejar el catálogo en blanco, y los puntos siguen siendo lo que el usuario vino a ver.
    profile.listNotifications.and.returnValue(throwError(() => new Error('boom')));
    const fixture = render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No pudimos cargar tu bandeja');
    expect(text).toContain('40');
    expect(text).not.toContain('No pudimos cargar el catálogo');
  });

  it('renders the featured article once in the hero and once in the list', () => {
    learning.listArticles.and.returnValue(of({ items: [article], total_size: 1 }));
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    // El destacado es un `<h2>` y la fila un `<h3>`, y `us4-editorial.spec.ts` busca
    // por `heading` de nivel 3: si el destacado también fuera `<h3>`, la aserción
    // encontraría dos encabezados con el mismo texto y fallaría por ambigüedad.
    expect(host.querySelectorAll('h3.fc-portal__row-title').length).toBe(1);
    expect(host.querySelectorAll('h2.fc-portal__hero-title').length).toBe(1);
    expect(host.querySelectorAll('a[href^="/articulos/"]').length).toBe(2);
  });

  it('filters by category through the rail and drops the featured block', () => {
    learning.listArticles.and.returnValue(of({ items: [article], total_size: 1 }));
    learning.listCategories.and.returnValue(
      of([{ category_id: 'c1', name: 'Presupuesto', slug: 'presupuesto', description: '', position: 1, active: true }]),
    );
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    const categoryButton = host.querySelector<HTMLButtonElement>('.fc-portal__cat:not(.fc-portal__cat--active)');
    expect(categoryButton?.textContent?.trim()).toBe('Presupuesto');
    categoryButton?.click();
    fixture.detectChanges();

    // Con una categoría activa no hay «destacado»: la primera tarjeta no es lo
    // destacado del portal, es la que salió primero.
    expect(host.querySelectorAll('h2.fc-portal__hero-title').length).toBe(0);
    expect(host.textContent).toContain('Quitar filtro');
    expect(learning.listArticles).toHaveBeenCalledWith('c1');
  });
});
