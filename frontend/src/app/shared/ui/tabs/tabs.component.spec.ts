import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabsComponent } from './tabs.component';

describe('TabsComponent', () => {
  let fixture: ComponentFixture<TabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TabsComponent] }).compileComponents();
    fixture = TestBed.createComponent(TabsComponent);
    fixture.componentRef.setInput('tabs', [
      { id: 'temas', label: 'Temas', count: 12 },
      { id: 'economico', label: 'Económico' },
    ]);
    fixture.detectChanges();
  });

  function tabButtons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]'));
  }

  it('exposes role="tablist" and one role="tab" per entry', () => {
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeTruthy();
    expect(tabButtons().length).toBe(2);
  });

  it('marks the first tab as selected by default', () => {
    expect(tabButtons()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabButtons()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('emits valueChange and updates aria-selected on click', () => {
    const spy = jasmine.createSpy('valueChange');
    fixture.componentInstance.valueChange.subscribe(spy);
    tabButtons()[1].click();
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith('economico');
    expect(tabButtons()[1].getAttribute('aria-selected')).toBe('true');
  });
});
