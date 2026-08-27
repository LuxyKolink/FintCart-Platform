import { ChangeDetectionStrategy, Component, EventEmitter, Output, input, signal } from '@angular/core';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

/** FintCart Tabs — underlined portal tabs (Topics / Economic / Sports…). */
@Component({
  selector: 'fc-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="tablist" class="fc-tabs">
      @for (tab of tabs(); track tab.id) {
        <button
          role="tab"
          type="button"
          class="fc-tabs__tab"
          [attr.aria-selected]="tab.id === activeId()"
          [class.fc-tabs__tab--active]="tab.id === activeId()"
          (click)="select(tab.id)"
        >
          {{ tab.label }}
          @if (tab.count !== undefined) {
            <span class="fc-num fc-tabs__count">{{ tab.count }}</span>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './tabs.component.css',
})
export class TabsComponent {
  readonly tabs = input.required<TabItem[]>();
  readonly value = input<string>();

  @Output() readonly valueChange = new EventEmitter<string>();

  private readonly internal = signal<string | undefined>(undefined);

  protected activeId(): string | undefined {
    return this.value() ?? this.internal() ?? this.tabs()[0]?.id;
  }

  protected select(id: string): void {
    if (this.value() === undefined) {
      this.internal.set(id);
    }
    this.valueChange.emit(id);
  }
}
