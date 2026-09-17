import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';

import { AppComponent } from './app.component';
import { AuthService } from './core/auth/auth.service';

type TestRole = 'aprendiz' | 'editor' | 'coordinador_editorial' | 'administrador';

/** Doble de `AuthService`: solo la superficie que el armazón consume. */
class AuthStub {
  public readonly authenticated = signal(false);
  public readonly roles = signal<TestRole[]>([]);
  public readonly isAuthenticated = this.authenticated.asReadonly();

  public hasRole(...allowed: TestRole[]): boolean {
    const mine = this.roles();
    return allowed.some((role) => mine.includes(role));
  }

  public logout(): Observable<void> {
    return of(void 0);
  }
}

describe('AppComponent — armazón', () => {
  let fixture: ComponentFixture<AppComponent>;
  let auth: AuthStub;

  beforeEach(async () => {
    auth = new AuthStub();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  function navLinks(): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('#fc-app-nav a')) as HTMLAnchorElement[];
  }

  function navLabels(): string[] {
    return navLinks().map((link) => link.textContent?.trim() ?? '');
  }

  function toggle(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.fc-topbar__toggle');
  }

  function signInAs(...roles: TestRole[]): void {
    auth.authenticated.set(true);
    auth.roles.set(roles);
    fixture.detectChanges();
  }

  it('shows only the brand, as a link home, when there is no session', () => {
    const brand: HTMLAnchorElement = fixture.nativeElement.querySelector('.fc-topbar__brand');
    expect(brand.getAttribute('aria-label')).toBe('FintCart — ir al catálogo');
    expect(fixture.nativeElement.querySelector('fc-brand-logo')).not.toBeNull();
    expect(navLinks().length).toBe(0);
    expect(toggle()).toBeNull();
  });

  it('is the single owner of the brand path: no hand-written logo reference remains', () => {
    const images: HTMLImageElement[] = Array.from(fixture.nativeElement.querySelectorAll('img'));
    for (const image of images) {
      expect(image.src).toContain('assets/logo/');
    }
  });

  it('derives a learner navigation from the role, without editorial or admin entries', () => {
    signInAs('aprendiz');
    // Las dos de calculadoras (T118, T119) son de CUALQUIER usuario y van juntas: el catálogo
    // de lo publicado y el taller de lo propio. Un aprendiz no ve «Revisión», que es lo que
    // esta prueba protege.
    expect(navLabels()).toEqual([
      'Catálogo',
      'Simuladores',
      'Calculadoras',
      'Mis calculadoras',
      'Tu progreso',
      'Notificaciones',
      'Tu perfil',
    ]);
  });

  it('adds the editorial entries for an editor but not the review queue', () => {
    signInAs('editor');
    const labels = navLabels();
    expect(labels).toContain('Editorial');
    expect(labels).not.toContain('Revisión');
    expect(labels).not.toContain('Curaduría');
    expect(labels).not.toContain('Administración');
  });

  it('adds the review queue for an editorial coordinator', () => {
    signInAs('coordinador_editorial');
    expect(navLabels()).toContain('Editorial');
    expect(navLabels()).toContain('Revisión');
    // La cola de calculadoras propuestas es del coordinador y de nadie más (FR-053): es la
    // segunda bandeja, y va con el mismo rol que la de artículos. Se llama «Curaduría» y no
    // «Revisión de calculadoras» porque un selector por subcadena sobre «Revisión» resolvería
    // DOS enlaces —el de los artículos y este— y rompería las pruebas de US4 (nota N-13).
    expect(navLabels()).toContain('Curaduría');
  });

  it('does not grant editorial attributions to an administrator (FR-077 boundary)', () => {
    signInAs('administrador');
    const labels = navLabels();
    expect(labels).toContain('Administración');
    expect(labels).not.toContain('Editorial');
    expect(labels).not.toContain('Revisión');
    expect(labels).not.toContain('Curaduría');
  });

  it('renders the logout action with the shared button and its accessible name', () => {
    signInAs('aprendiz');
    const logout: HTMLButtonElement = fixture.nativeElement.querySelector('#fc-app-nav fc-button button');
    expect(logout.textContent?.trim()).toBe('Cerrar sesión');
  });

  it('collapses the navigation into a disclosure that reports its state', () => {
    signInAs('aprendiz');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe('fc-app-nav');

    toggle().click();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const nav: HTMLElement = fixture.nativeElement.querySelector('#fc-app-nav');
    expect(nav.classList.contains('fc-topbar__nav--open')).toBeTrue();
  });

  it('closes the menu when a destination is chosen', () => {
    signInAs('aprendiz');
    toggle().click();
    fixture.detectChanges();

    navLinks()[0].click();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the menu with the Escape key', () => {
    signInAs('aprendiz');
    toggle().click();
    fixture.detectChanges();

    const header: HTMLElement = fixture.nativeElement.querySelector('.fc-topbar');
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});
