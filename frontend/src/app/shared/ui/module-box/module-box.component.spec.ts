import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModuleBoxComponent } from './module-box.component';

describe('ModuleBoxComponent', () => {
  let fixture: ComponentFixture<ModuleBoxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModuleBoxComponent] }).compileComponents();
    fixture = TestBed.createComponent(ModuleBoxComponent);
  });

  it('renders the header with its title when title() is set', () => {
    fixture.componentRef.setInput('title', 'Progreso reciente');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('header')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('h3').textContent).toContain('Progreso reciente');
  });

  it('omits the header entirely when no title is provided', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('header')).toBeFalsy();
  });

  it('exposes the accent as a data attribute for styling', () => {
    fixture.componentRef.setInput('title', 'Alertas');
    fixture.componentRef.setInput('accent', 'danger');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('header').getAttribute('data-accent')).toBe('danger');
  });
});
