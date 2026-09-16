import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { SkeletonComponent } from './skeleton.component';

@Component({
  standalone: true,
  imports: [SkeletonComponent],
  template: `<fc-skeleton variant="title" [lines]="3" width="60%" label="Cargando artículos" />`,
})
class HostComponent {}

describe('SkeletonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('renders one bar per requested line and exposes the variant as a data attribute', () => {
    const root: HTMLElement = fixture.nativeElement.querySelector('.fc-skeleton');
    expect(root.getAttribute('data-variant')).toBe('title');
    expect(root.querySelectorAll('.fc-skeleton__bar').length).toBe(3);
  });

  it('carries the data-driven width as a custom property, keeping the template free of style attributes', () => {
    const root: HTMLElement = fixture.nativeElement.querySelector('.fc-skeleton');
    expect(root.style.getPropertyValue('--fc-skeleton-w')).toBe('60%');
  });

  it('is announced as a status and hides its decorative geometry from assistive tech', () => {
    const root: HTMLElement = fixture.nativeElement.querySelector('.fc-skeleton');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-label')).toBe('Cargando artículos');

    const bars = root.querySelectorAll('.fc-skeleton__bar');
    bars.forEach((bar) => expect(bar.getAttribute('aria-hidden')).toBe('true'));
  });

  it('collapses circle and rect to a single piece regardless of the line count', () => {
    const direct = TestBed.createComponent(SkeletonComponent);
    direct.componentRef.setInput('variant', 'circle');
    direct.componentRef.setInput('lines', 5);
    direct.detectChanges();

    const root: HTMLElement = direct.nativeElement.querySelector('.fc-skeleton');
    expect(root.querySelectorAll('.fc-skeleton__bar').length).toBe(1);
  });

  it('never renders zero lines, so a loading state cannot look like an empty screen', () => {
    const direct = TestBed.createComponent(SkeletonComponent);
    direct.componentRef.setInput('lines', 0);
    direct.detectChanges();

    expect(direct.nativeElement.querySelectorAll('.fc-skeleton__bar').length).toBe(1);
  });

  it('can silence its live region when the surrounding region already announces the load', () => {
    const direct = TestBed.createComponent(SkeletonComponent);
    direct.componentRef.setInput('label', null);
    direct.detectChanges();

    const root: HTMLElement = direct.nativeElement.querySelector('.fc-skeleton');
    expect(root.hasAttribute('aria-label')).toBe(false);
  });
});
