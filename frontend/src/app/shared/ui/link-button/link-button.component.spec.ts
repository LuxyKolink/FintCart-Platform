import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LinkButtonComponent } from './link-button.component';

/**
 * Host mínimo: el texto y los iconos llegan por PROYECCIÓN, así que una prueba que solo
 * mire el `<a>` no verifica nada. La primera versión de este componente era un modo de
 * `fc-button` y renderizaba un `<a>` vacío porque Angular no proyecta `<ng-content>`
 * dentro de un `@if`; estas aserciones son las que habrían fallado entonces.
 */
@Component({
  standalone: true,
  imports: [LinkButtonComponent],
  template: `<fc-link-button [to]="['/cuestionarios', 'abc']" variant="secondary" size="sm">
    Iniciar cuestionario
  </fc-link-button>`,
})
class HostComponent {}

describe('LinkButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  function anchor(): HTMLAnchorElement {
    return fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
  }

  it('renders the projected content inside the anchor', () => {
    expect(anchor().textContent?.trim()).toBe('Iniciar cuestionario');
  });

  it('is a real link, never a button', () => {
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(anchor().getAttribute('href')).toBe('/cuestionarios/abc');
  });

  it('keeps the button styling contract', () => {
    expect(anchor().classList.contains('fc-btn')).toBeTrue();
    expect(anchor().getAttribute('data-variant')).toBe('secondary');
    expect(anchor().getAttribute('data-size')).toBe('sm');
  });
});
