import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AvatarComponent } from './avatar.component';

describe('AvatarComponent', () => {
  let fixture: ComponentFixture<AvatarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AvatarComponent] }).compileComponents();
    fixture = TestBed.createComponent(AvatarComponent);
  });

  it('derives up to two uppercase initials from name()', () => {
    fixture.componentRef.setInput('name', 'Ana María Ruiz');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.fc-avatar').textContent.trim()).toBe('AM');
  });

  it('falls back to a middle dot when name() is empty', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.fc-avatar').textContent.trim()).toBe('·');
  });

  it('renders an image instead of initials when src() is set', () => {
    fixture.componentRef.setInput('name', 'Ana Ruiz');
    fixture.componentRef.setInput('src', 'ana.jpg');
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.alt).toBe('Ana Ruiz');
  });
});
