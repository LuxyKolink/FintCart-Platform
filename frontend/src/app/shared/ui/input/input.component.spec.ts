import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InputComponent } from './input.component';

describe('InputComponent', () => {
  let fixture: ComponentFixture<InputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InputComponent] }).compileComponents();
    fixture = TestBed.createComponent(InputComponent);
    fixture.componentRef.setInput('label', 'Correo electrónico');
    fixture.detectChanges();
  });

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input');
  }

  function label(): HTMLLabelElement {
    return fixture.nativeElement.querySelector('label');
  }

  it('associates the label with the input via for/id', () => {
    expect(label().getAttribute('for')).toBe(input().id);
  });

  it('propagates typed values through the ControlValueAccessor', () => {
    const onChange = jasmine.createSpy('onChange');
    fixture.componentInstance.registerOnChange(onChange);
    input().value = 'ana@example.com';
    input().dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenCalledWith('ana@example.com');
  });

  it('marks aria-invalid and shows the error message when error() is set', () => {
    fixture.componentRef.setInput('error', 'Correo inválido');
    fixture.detectChanges();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Correo inválido');
  });

  it('disables the input when setDisabledState(true) is called', () => {
    fixture.componentInstance.setDisabledState(true);
    fixture.detectChanges();
    expect(input().disabled).toBeTrue();
  });
});
