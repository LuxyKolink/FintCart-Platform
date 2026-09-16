import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { ProfileError, ProfileService } from '../profile.service';
import { DeleteAccountComponent } from './delete-account.component';

/**
 * T059/T060 / FR-112: la consecuencia de la operación se comunica ANTES del formulario y de
 * forma destacada, y no se anuncia ningún período de reversión porque hoy no existe (depende
 * del estado `pending_deletion` de 002, que aún no está implementado).
 */
describe('DeleteAccountComponent', () => {
  let api: { deleteAccount: jasmine.Spy };
  let auth: { clearSession: jasmine.Spy };

  beforeEach(() => {
    api = { deleteAccount: jasmine.createSpy('deleteAccount').and.returnValue(of({})) };
    auth = { clearSession: jasmine.createSpy('clearSession') };
  });

  async function render(): Promise<ComponentFixture<DeleteAccountComponent>> {
    await TestBed.configureTestingModule({
      imports: [DeleteAccountComponent],
      providers: [
        provideRouter([]),
        { provide: ProfileService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeleteAccountComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('warns about the irreversible consequence before offering the form', async () => {
    const host = (await render()).nativeElement as HTMLElement;
    const text = host.textContent ?? '';

    expect(text).toContain('irreversible');
    // El aviso va en un componente de aviso, no en un párrafo cualquiera (FR-112).
    expect(host.querySelector('fc-banner[data-tone="error"], fc-banner .fc-banner[data-tone="error"]')).not.toBeNull();
    // La advertencia precede al formulario de confirmación.
    expect(text.indexOf('irreversible')).toBeLessThan(text.indexOf('ELIMINAR MI CUENTA'));
  });

  it('does not promise a reversal window the platform does not have', async () => {
    const host = (await render()).nativeElement as HTMLElement;
    const text = host.textContent ?? '';

    // 002 define una gracia de 30 días, pero no está implementada: anunciarla sería una
    // promesa de reversibilidad sobre una operación sin vuelta atrás.
    expect(text).not.toContain('30 días');
    expect(text).toContain('No podrás volver a iniciar sesión');
  });

  it('requires the exact phrase and does not call the server otherwise', async () => {
    const fixture = await render();
    const internals = fixture.componentInstance as unknown as {
      form: { patchValue(value: object): void };
      onSubmit(): void;
    };

    internals.form.patchValue({ confirmation: 'eliminar mi cuenta' });
    internals.onSubmit();

    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it('accepts the request, closes the session and offers a way to log in again', async () => {
    const fixture = await render();
    const internals = fixture.componentInstance as unknown as {
      form: { patchValue(value: object): void };
      onSubmit(): void;
    };

    internals.form.patchValue({ confirmation: 'ELIMINAR MI CUENTA' });
    internals.onSubmit();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Recibimos tu solicitud');
    expect(auth.clearSession).toHaveBeenCalled();
    // `us3-perfil.spec.ts` pulsa este control como BOTÓN: navega por código, no por enlace.
    expect(host.querySelector('button')?.textContent).toContain('Ir a iniciar sesión');
    expect(host.querySelector('a[href="/iniciar-sesion"]')).toBeNull();
  });

  it('shows the failure without clearing the phrase the user wrote', async () => {
    api.deleteAccount.and.returnValue(
      throwError(() => new ProfileError('server', 'No pudimos completar la operación. Intenta de nuevo.')),
    );
    const fixture = await render();
    const internals = fixture.componentInstance as unknown as {
      form: { patchValue(value: object): void; getRawValue(): { confirmation: string } };
      onSubmit(): void;
    };

    internals.form.patchValue({ confirmation: 'ELIMINAR MI CUENTA' });
    internals.onSubmit();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No pudimos completar la operación');
    expect(internals.form.getRawValue().confirmation).toBe('ELIMINAR MI CUENTA');
  });
});
