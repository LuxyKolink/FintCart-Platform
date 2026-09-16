import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BrandIndicator, BrandPanelComponent } from './brand-panel.component';

@Component({
  standalone: true,
  imports: [BrandPanelComponent],
  template: `<fc-brand-panel />`,
})
class DefaultHostComponent {}

describe('BrandPanelComponent', () => {
  describe('por defecto', () => {
    let fixture: ComponentFixture<DefaultHostComponent>;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [DefaultHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(DefaultHostComponent);
      fixture.detectChanges();
    });

    it('shows the logo, the wordmark, the headline and the subheadline', () => {
      const root: HTMLElement = fixture.nativeElement.querySelector('.fc-brand-panel');
      expect(root.querySelector('fc-brand-logo img')?.getAttribute('src')).toContain(
        'assets/logo/fintcart-mark.svg',
      );
      expect(root.querySelector('.fc-brand-panel__wordmark')?.textContent).toContain('FintCart');
      expect(root.querySelector('.fc-brand-panel__title')?.textContent).toContain(
        'Aprende a manejar tu plata',
      );
      expect(root.querySelector('.fc-brand-panel__subtitle')?.textContent).toContain(
        'contexto colombiano',
      );
    });

    it('lists the three content indicators', () => {
      const indicators = fixture.nativeElement.querySelectorAll('.fc-brand-panel__indicator');
      expect(indicators.length).toBe(3);
    });

    it('does NOT claim a content count the platform cannot back', () => {
      // El kit escribe «+120 artículos» y «5 simuladores»; la semilla deja 5 y 7.
      // Un número inventado es un dato falso, no un texto incompleto (N-15).
      const text: string = fixture.nativeElement.textContent;
      expect(text).not.toMatch(/\+\d/u);
      expect(text).not.toMatch(/\d+\s+simuladores/u);
    });

    it('renders the headline as a real heading level for the outline', () => {
      const title: HTMLElement = fixture.nativeElement.querySelector('.fc-brand-panel__title');
      expect(title.tagName).toBe('H2');
    });
  });

  describe('parametrizado', () => {
    it('accepts a custom headline, subheadline and indicator list', async () => {
      const custom: BrandIndicator[] = [{ icon: 'check-circle', label: 'Solo uno' }];
      const fixture = TestBed.createComponent(BrandPanelComponent);
      fixture.componentRef.setInput('title', 'Otro titular');
      fixture.componentRef.setInput('subtitle', 'Otro subtítulo');
      fixture.componentRef.setInput('indicators', custom);
      fixture.detectChanges();

      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('.fc-brand-panel__title')?.textContent).toContain('Otro titular');
      const indicators = root.querySelectorAll('.fc-brand-panel__indicator');
      expect(indicators.length).toBe(1);
      expect(indicators[0].textContent).toContain('Solo uno');
    });

    it('omits the indicator list entirely when it is empty', () => {
      const fixture = TestBed.createComponent(BrandPanelComponent);
      fixture.componentRef.setInput('indicators', []);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.fc-brand-panel__indicators')).toBeNull();
    });
  });
});
