import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressBarComponent } from './progress-bar.component';

describe('ProgressBarComponent', () => {
  let fixture: ComponentFixture<ProgressBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProgressBarComponent] }).compileComponents();
    fixture = TestBed.createComponent(ProgressBarComponent);
  });

  function track(): HTMLElement {
    return fixture.nativeElement.querySelector('[role="progressbar"]');
  }

  it('exposes role="progressbar" with aria-value bounds', () => {
    fixture.componentRef.setInput('value', 65);
    fixture.componentRef.setInput('max', 100);
    fixture.detectChanges();
    expect(track().getAttribute('aria-valuenow')).toBe('65');
    expect(track().getAttribute('aria-valuemin')).toBe('0');
    expect(track().getAttribute('aria-valuemax')).toBe('100');
  });

  it('sets the fill width to the clamped percentage', () => {
    fixture.componentRef.setInput('value', 150);
    fixture.componentRef.setInput('max', 100);
    fixture.detectChanges();
    const fill: HTMLElement = fixture.nativeElement.querySelector('.fc-progress__fill');
    expect(fill.style.width).toBe('100%');
  });

  it('shows the label and value readout when requested', () => {
    fixture.componentRef.setInput('label', 'Progreso del módulo');
    fixture.componentRef.setInput('showValue', true);
    fixture.componentRef.setInput('value', 4);
    fixture.componentRef.setInput('max', 10);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Progreso del módulo');
    expect(fixture.nativeElement.textContent).toContain('4/10');
  });
});
