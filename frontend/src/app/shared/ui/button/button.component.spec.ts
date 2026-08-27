import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from './button.component';

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
});
