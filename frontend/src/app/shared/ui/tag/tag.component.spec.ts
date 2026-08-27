import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TagComponent } from './tag.component';

describe('TagComponent', () => {
  let fixture: ComponentFixture<TagComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TagComponent] }).compileComponents();
    fixture = TestBed.createComponent(TagComponent);
  });

  it('renders a <button> when no href is given', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a')).toBeFalsy();
  });

  it('renders an <a> when href() is set', () => {
    fixture.componentRef.setInput('href', '/catalogo?categoria=ahorro');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/catalogo?categoria=ahorro');
  });

  it('emits pressed on click for the button variant', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('pressed');
    fixture.componentInstance.pressed.subscribe(spy);
    fixture.nativeElement.querySelector('button').click();
    expect(spy).toHaveBeenCalled();
  });

  it('exposes the category as a data attribute for styling', () => {
    fixture.componentRef.setInput('category', 'ahorro');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').getAttribute('data-category')).toBe('ahorro');
  });
});
