import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectComponent } from './select.component';

describe('SelectComponent', () => {
  let fixture: ComponentFixture<SelectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectComponent] }).compileComponents();
    fixture = TestBed.createComponent(SelectComponent);
    fixture.componentRef.setInput('label', 'Categoría');
    fixture.componentRef.setInput('options', [
      { value: 'ahorro', label: 'Ahorro' },
      { value: 'credito', label: 'Crédito' },
    ]);
    fixture.detectChanges();
  });

  function select(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('select');
  }

  function label(): HTMLLabelElement {
    return fixture.nativeElement.querySelector('label');
  }

  it('associates the label with the select via for/id', () => {
    expect(label().getAttribute('for')).toBe(select().id);
  });

  it('renders one option per entry in options()', () => {
    expect(select().querySelectorAll('option').length).toBe(2);
  });

  it('propagates the selected value through the ControlValueAccessor', () => {
    const onChange = jasmine.createSpy('onChange');
    fixture.componentInstance.registerOnChange(onChange);
    select().value = 'credito';
    select().dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('credito');
  });
});
