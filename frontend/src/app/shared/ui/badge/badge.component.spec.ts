import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { BadgeComponent } from './badge.component';

@Component({
  standalone: true,
  imports: [BadgeComponent],
  template: `<fc-badge tone="success" variant="solid">Aprobado</fc-badge>`,
})
class HostComponent {}

describe('BadgeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('projects its content and exposes tone/variant as data attributes', () => {
    const badge = fixture.nativeElement.querySelector('.fc-badge');
    expect(badge.textContent).toContain('Aprobado');
    expect(badge.getAttribute('data-tone')).toBe('success');
    expect(badge.getAttribute('data-variant')).toBe('solid');
  });
});
