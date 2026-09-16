import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from './button.component';

/**
 * Host mínimo: el texto del botón llega por PROYECCIÓN, así que una prueba que solo
 * mire el `<button>` no verifica nada. Es la misma lección que dejó `fc-link-button`
 * (ver la nota de `LinkButtonComponent`): proyectar dentro de un bloque `@if` deja el
 * elemento vacío, y solo se nota afirmando el TEXTO.
 */
@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `<fc-button variant="danger" size="lg" (pressed)="clicks = clicks + 1">
    Eliminar cuenta
  </fc-button>`,
})
class HostComponent {
  clicks = 0;
}

describe('ButtonComponent', () => {
  let fixture: ComponentFixture<ButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ButtonComponent] }).compileComponents();
    fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
  });

  function button(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button');
  }

  it('renders a native button defaulting to type="button"', () => {
    expect(button().type).toBe('button');
  });

  it('emits pressed on click when enabled', () => {
    const spy = jasmine.createSpy('pressed');
    fixture.componentInstance.pressed.subscribe(spy);
    button().click();
    expect(spy).toHaveBeenCalled();
  });

  it('disables the native button when disabled() is true', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();
  });

  it('exposes variant and size as data attributes for styling', () => {
    fixture.componentRef.setInput('variant', 'danger');
    fixture.componentRef.setInput('size', 'lg');
    fixture.detectChanges();
    expect(button().getAttribute('data-variant')).toBe('danger');
    expect(button().getAttribute('data-size')).toBe('lg');
  });

  it('renders the projected content inside the button', async () => {
    const host = TestBed.createComponent(HostComponent);
    host.detectChanges();

    const rendered = host.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(rendered.textContent?.trim()).toBe('Eliminar cuenta');
    expect(rendered.getAttribute('data-variant')).toBe('danger');
  });

  it('is never an anchor: la navegación es de `fc-link-button`', () => {
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
  });
});
