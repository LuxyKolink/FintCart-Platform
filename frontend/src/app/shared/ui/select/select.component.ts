import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import type { FieldSize } from '../input/input.component';

export interface SelectOption {
  value: string;
  label: string;
}

let nextId = 0;

/** FintCart Select — native dropdown styled to match Input. Consumed by the category dropdown of US1. */
@Component({
  selector: 'fc-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectComponent),
      multi: true,
    },
  ],
  template: `
    <div class="fc-field">
      @if (label()) {
        <label [for]="selectId" class="fc-field__label">{{ label() }}</label>
      }
      <div class="fc-select__wrap">
        <select
          [id]="selectId"
          class="fc-select"
          [attr.data-invalid]="!!error() || null"
          [attr.data-size]="size()"
          [attr.aria-invalid]="!!error() || null"
          [disabled]="disabled()"
          [value]="value()"
          (change)="onSelect($event)"
          (blur)="onTouched()"
        >
          @for (option of options(); track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </select>
        <span aria-hidden="true" class="fc-select__chevron">▾</span>
      </div>
      @if (hint() || error()) {
        <span class="fc-field__help" [attr.data-invalid]="!!error() || null">{{ error() || hint() }}</span>
      }
    </div>
  `,
  styleUrl: './select.component.css',
})
export class SelectComponent implements ControlValueAccessor {
  readonly label = input<string>();
  readonly hint = input<string>();
  readonly error = input<string>();
  readonly size = input<FieldSize>('md');
  readonly options = input.required<SelectOption[]>();

  protected readonly selectId = `fc-select-${++nextId}`;
  protected readonly value = signal('');
  protected readonly disabled = signal(false);

  private onChangeFn: (value: string) => void = () => {};
  protected onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChangeFn = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.value.set(value);
    this.onChangeFn(value);
  }
}
