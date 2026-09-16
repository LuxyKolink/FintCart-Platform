import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BannerComponent } from './banner.component';

@Component({
  standalone: true,
  imports: [BannerComponent],
  template: `
    <fc-banner tone="error" data-testid="error">No pudimos iniciar sesión.</fc-banner>
    <fc-banner tone="success" data-testid="success">Tu correo quedó verificado.</fc-banner>
    <fc-banner data-testid="default">Mensaje neutro.</fc-banner>
  `,
})
class HostComponent {}

describe('BannerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('announces errors assertively and the rest politely', () => {
    const error: HTMLElement = fixture.nativeElement.querySelector('[data-testid="error"] .fc-banner');
    const success: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="success"] .fc-banner',
    );
    expect(error.getAttribute('role')).toBe('alert');
    expect(success.getAttribute('role')).toBe('status');
  });

  it('defaults to the info tone', () => {
    const neutral: HTMLElement = fixture.nativeElement.querySelector('[data-testid="default"] .fc-banner');
    expect(neutral.getAttribute('data-tone')).toBe('info');
    expect(neutral.getAttribute('role')).toBe('status');
  });

  it('projects the message so links and emphasis survive', () => {
    const error: HTMLElement = fixture.nativeElement.querySelector('[data-testid="error"] .fc-banner');
    expect(error.textContent).toContain('No pudimos iniciar sesión.');
  });
});
