import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CheckboxComponent } from './checkbox.component';

describe('CheckboxComponent', () => {
  let fixture: ComponentFixture<CheckboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CheckboxComponent] }).compileComponents();
    fixture = TestBed.createComponent(CheckboxComponent);
    fixture.componentRef.setInput('label', 'Recordarme');
    fixture.detectChanges();
  });

  function checkbox(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input[type="checkbox"]');
  }

  function label(): HTMLLabelElement {
    return fixture.nativeElement.querySelector('label');
  }

  it('associates the label with the checkbox via for/id', () => {
    expect(label().getAttribute('for')).toBe(checkbox().id);
  });

  it('reflects writeValue() as the checked state', () => {
    fixture.componentInstance.writeValue(true);
    fixture.detectChanges();
    expect(checkbox().checked).toBeTrue();
  });

  it('calls the registered onChange with the new checked value', () => {
    const onChange = jasmine.createSpy('onChange');
    fixture.componentInstance.registerOnChange(onChange);
    checkbox().checked = true;
    checkbox().dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
