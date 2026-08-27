import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type FieldSize = 'sm' | 'md' | 'lg';

let nextId = 0;

/** FintCart Input — text field with label/hint/error, ported from design/components/forms/Input.jsx. */
@Component({
  selector: 'fc-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
  template: `
    <div class="fc-field">
      @if (label()) {
        <label [for]="inputId" class="fc-field__label">{{ label() }}</label>
      }
      <div class="fc-field__control" [attr.data-invalid]="!!error() || null" [attr.data-size]="size()">
        @if (prefix()) {
          <span class="fc-field__affix">{{ prefix() }}</span>
        }
        <input
          [id]="inputId"
          [type]="type()"
          [placeholder]="placeholder() ?? ''"
          [attr.aria-invalid]="!!error() || null"
          [attr.aria-describedby]="hint() || error() ? inputId + '-help' : null"
          [disabled]="disabled()"
          [value]="value()"
          (input)="onInput($event)"
          (blur)="onTouched()"
          class="fc-field__input"
        />
        @if (suffix()) {
          <span class="fc-field__affix">{{ suffix() }}</span>
        }
      </div>
      @if (hint() || error()) {
        <span [id]="inputId + '-help'" class="fc-field__help" [attr.data-invalid]="!!error() || null">
          {{ error() || hint() }}
        </span>
      }
    </div>
  `,
  styleUrl: './input.component.css',
})
export class InputComponent implements ControlValueAccessor {
  readonly label = input<string>();
  readonly hint = input<string>();
  readonly error = input<string>();
  readonly prefix = input<string>();
  readonly suffix = input<string>();
  readonly size = input<FieldSize>('md');
  readonly type = input<string>('text');
  readonly placeholder = input<string>();

  protected readonly inputId = `fc-input-${++nextId}`;
  protected readonly value = signal('');
  protected readonly disabled = signal(false);

  private onChange: (value: string) => void = () => {};
  protected onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value.set(value);
    this.onChange(value);
  }
}
