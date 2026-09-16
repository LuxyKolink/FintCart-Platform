import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ProfileService } from '../profile/profile.service';
import { NotificationsComponent } from './notifications.component';

/**
 * T036/T037: la bandeja distingue lo leído de lo no leído (FR-106) y no deja un hueco en
 * blanco cuando está vacía (FR-119).
 *
 * El texto de cada entrada NO se inventa: sale del `payload` que publica el Orquestador
 * al calificar un intento. Estas pruebas fijan las dos formas que ese payload tiene hoy
 * —`resultado_cuestionario` y `hito_progreso`— para que un cambio de claves del emisor se
 * note aquí y no en producción.
 */
describe('NotificationsComponent', () => {
  let api: { listNotifications: jasmine.Spy; markNotificationRead: jasmine.Spy };

  beforeEach(async () => {
    api = {
      listNotifications: jasmine.createSpy('listNotifications').and.returnValue(of({ items: [], total_size: 0 })),
      markNotificationRead: jasmine.createSpy('markNotificationRead').and.returnValue(of({})),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [provideRouter([]), { provide: ProfileService, useValue: api }],
    }).compileComponents();
  });

  function render(): ComponentFixture<NotificationsComponent> {
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a meaningful empty state instead of a blank page', () => {
    const host = render().nativeElement as HTMLElement;

    expect(host.textContent).toContain('Todavía no tienes notificaciones');
    expect(host.textContent).toContain('No tienes notificaciones sin leer');
  });

  it('marks the unread entry with more than colour', () => {
    api.listNotifications.and.returnValue(
      of({
        items: [{ id: 'n1', type: 'hito_progreso', read_state: 'unread', created_at: '2026-06-12T10:00:00Z', payload: { points: 300 } }],
        total_size: 1,
      }),
    );
    const host = render().nativeElement as HTMLElement;

    // Fondo distinto + etiqueta textual + botón de acción: tres señales, no un matiz.
    expect(host.querySelectorAll('.fc-inbox__item--unread').length).toBe(1);
    expect(host.textContent).toContain('sin leer');
    expect(host.textContent).toContain('Marcar como leída');
    expect(host.textContent).toContain('Llevas 300 puntos acumulados');
  });

  it('does not offer the read action on an entry that is already read', () => {
    api.listNotifications.and.returnValue(
      of({
        items: [
          { id: 'n1', type: 'resultado_cuestionario', read_state: 'read', created_at: '2026-06-12T10:00:00Z', payload: { score: '66.67', passed: true } },
        ],
        total_size: 1,
      }),
    );
    const host = render().nativeElement as HTMLElement;

    expect(host.querySelectorAll('.fc-inbox__item--unread').length).toBe(0);
    expect(host.textContent).not.toContain('Marcar como leída');
    // El puntaje llega como cadena decimal y se muestra sin truncar (Principio VIII).
    expect(host.textContent).toContain('66.67 de 100');
    expect(host.textContent).toContain('Aprobado');
  });

  it('undoes the optimistic read if the server rejects it', () => {
    api.listNotifications.and.returnValue(
      of({
        items: [{ id: 'n1', type: 'recordatorio', read_state: 'unread', created_at: '2026-06-12T10:00:00Z' }],
        total_size: 1,
      }),
    );
    api.markNotificationRead.and.returnValue(throwError(() => new Error('boom')));
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('.fc-inbox__action button')?.click();
    fixture.detectChanges();

    expect(api.markNotificationRead).toHaveBeenCalledWith('n1');
    // El estado optimista se REVIERTE: la bandeja no puede quedar mintiendo sobre lo
    // que el servidor no aceptó.
    expect(host.querySelectorAll('.fc-inbox__item--unread').length).toBe(1);
    expect(host.textContent).toContain('Marcar como leída');
  });
});
