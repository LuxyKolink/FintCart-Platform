import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { CardComponent } from './card.component';

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `<fc-card>Contenido</fc-card>`,
})
class HostComponent {}

describe('CardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('projects its content', () => {
    expect(fixture.nativeElement.textContent).toContain('Contenido');
  });

  it('is padded by default and stops being padded when padded() is false', () => {
    const card = fixture.nativeElement.querySelector('fc-card > div');
    expect(card.classList).toContain('fc-card--padded');
  });
});
