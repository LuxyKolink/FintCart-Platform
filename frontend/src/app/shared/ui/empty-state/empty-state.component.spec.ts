import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { EmptyStateComponent } from './empty-state.component';

@Component({
  standalone: true,
  imports: [EmptyStateComponent],
  template: `
    <fc-empty-state
      icon="book-open"
      title="Aún no hay artículos"
      message="Publica el primero para verlo aquí."
    >
      <button type="button">Crear artículo</button>
    </fc-empty-state>
  `,
})
class HostComponent {}

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('announces itself as a status and shows title and message', () => {
    const root: HTMLElement = fixture.nativeElement.querySelector('.fc-empty-state');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.querySelector('.fc-empty-state__title')?.textContent).toContain(
      'Aún no hay artículos',
    );
    expect(root.querySelector('.fc-empty-state__message')?.textContent).toContain(
      'Publica el primero',
    );
  });

  it('projects the suggested action as a real, keyboard-reachable control', () => {
    const action: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.fc-empty-state__action button',
    );
    expect(action).not.toBeNull();
    expect(action.textContent).toContain('Crear artículo');
    expect(action.type).toBe('button');
  });

  it('renders the icon as decorative, without stealing the message name', () => {
    const icon: HTMLElement = fixture.nativeElement.querySelector('fc-icon');
    expect(icon).not.toBeNull();
    expect(icon.querySelector('svg')?.getAttribute('title')).toBeNull();
  });

  it('omits the message paragraph entirely when there is no message', () => {
    const direct = TestBed.createComponent(EmptyStateComponent);
    direct.componentRef.setInput('title', 'Sin resultados');
    direct.detectChanges();

    expect(direct.nativeElement.querySelector('.fc-empty-state__title')?.textContent).toContain(
      'Sin resultados',
    );
    expect(direct.nativeElement.querySelector('.fc-empty-state__message')).toBeNull();
  });
});
