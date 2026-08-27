import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

/** FintCart Checkbox — square, with optional inline label. */
@Component({
  selector: 'fc-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CheckboxComponent),
      multi: true,
    },
  ],
  template: `
    <label [for]="checkboxId" class="fc-checkbox" [attr.data-disabled]="disabled() || null">
      <input
        [id]="checkboxId"
        type="checkbox"
        class="fc-checkbox__input"
        [checked]="checked()"
        [disabled]="disabled()"
        (change)="onChange($event)"
        (blur)="onTouched()"
      />
      @if (label()) {
        <span>{{ label() }}</span>
      }
    </label>
  `,
  styleUrl: './checkbox.component.css',
})
export class CheckboxComponent implements ControlValueAccessor {
  readonly label = input<string>();

  protected readonly checkboxId = `fc-checkbox-${++nextId}`;
  protected readonly checked = signal(false);
  protected readonly disabled = signal(false);

  private onChangeFn: (value: boolean) => void = () => {};
  protected onTouched: () => void = () => {};

  writeValue(value: boolean | null): void {
    this.checked.set(!!value);
  }

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChangeFn = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onChange(event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.checked.set(value);
    this.onChangeFn(value);
  }
}
