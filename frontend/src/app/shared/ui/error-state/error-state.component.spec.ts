import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { ErrorStateComponent } from './error-state.component';

@Component({
  standalone: true,
  imports: [ErrorStateComponent],
  template: `
    <fc-error-state
      message="No pudimos cargar el catálogo."
      retryLabel="Volver a intentar"
      (retry)="onRetry()"
    />
  `,
})
class HostComponent {
  retries = 0;

  onRetry(): void {
    this.retries += 1;
  }
}

describe('ErrorStateComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('announces the failure assertively, unlike a polite loading status', () => {
    const root: HTMLElement = fixture.nativeElement.querySelector('.fc-error-state');
    expect(root.getAttribute('role')).toBe('alert');
    expect(root.querySelector('.fc-error-state__message')?.textContent).toContain(
      'No pudimos cargar',
    );
  });

  it('always ships a retry action, named by its own text, that emits on activation', () => {
    const retry: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.fc-error-state__action button',
    );
    expect(retry).not.toBeNull();
    expect(retry.textContent).toContain('Volver a intentar');

    retry.click();
    fixture.detectChanges();
    expect(host.retries).toBe(1);
  });

  it('disables the retry action while a retry is already in flight', () => {
    const direct = TestBed.createComponent(ErrorStateComponent);
    direct.componentRef.setInput('retrying', true);
    direct.detectChanges();

    const retry: HTMLButtonElement = direct.nativeElement.querySelector('button');
    expect(retry.disabled).toBe(true);
  });

  it('falls back to a human title instead of exposing a bare failure', () => {
    const direct = TestBed.createComponent(ErrorStateComponent);
    direct.detectChanges();

    expect(direct.nativeElement.querySelector('.fc-error-state__title')?.textContent).toContain(
      'Algo salió mal',
    );
  });
});
