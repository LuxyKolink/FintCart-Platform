import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { ProfileError, ProfileService } from '../profile.service';
import { PasswordComponent } from './password.component';

/**
 * T056/T060: el cambio de contraseña avisa de que cierra las sesiones —incluida la de esta
 * pestaña— y no limpia el formulario si el borde rechaza la operación.
 */
describe('PasswordComponent', () => {
  let api: { changePassword: jasmine.Spy };
  let auth: { clearSession: jasmine.Spy };

  beforeEach(() => {
    api = { changePassword: jasmine.createSpy('changePassword').and.returnValue(of({})) };
    auth = { clearSession: jasmine.createSpy('clearSession') };
  });

  async function render(): Promise<ComponentFixture<PasswordComponent>> {
    await TestBed.configureTestingModule({
      imports: [PasswordComponent],
      providers: [
        provideRouter([]),
        { provide: ProfileService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PasswordComponent);
    fixture.detectChanges();
    return fixture;
  }

  function fill(fixture: ComponentFixture<PasswordComponent>): void {
    (fixture.componentInstance as unknown as { form: { patchValue(value: object): void } }).form.patchValue({
      currentPassword: 'Dem0stracion!2026',
      newPassword: 'Dem0stracion!2027',
    });
  }

  it('states that every open session is closed, before the user commits', async () => {
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('se cierran todas tus sesiones');
  });

  it('explains the session closure and clears the local one', async () => {
    const fixture = await render();
    fill(fixture);
    (fixture.componentInstance as unknown as { onSubmit(): void }).onSubmit();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // El texto que `us3-perfil.spec.ts` busca para saber que el cambio se aplicó.
    expect(host.textContent).toContain('cerramos tu sesión actual');
    expect(auth.clearSession).toHaveBeenCalled();
    // La salida es un ENLACE, no un botón: navega, no ejecuta.
    expect(host.querySelector('a[href="/iniciar-sesion"]')).not.toBeNull();
  });

  it('keeps both fields when the current password is wrong', async () => {
    api.changePassword.and.returnValue(
      throwError(() => new ProfileError('invalid', 'La contraseña actual no coincide.')),
    );
    const fixture = await render();
    fill(fixture);
    (fixture.componentInstance as unknown as { onSubmit(): void }).onSubmit();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('La contraseña actual no coincide');
    // La nueva no se pierde: el usuario no tiene que volver a escribirla.
    const form = (fixture.componentInstance as unknown as { form: { getRawValue(): { newPassword: string } } })
      .form;
    expect(form.getRawValue().newPassword).toBe('Dem0stracion!2027');
  });

  it('does not call the server while the new password is too short', async () => {
    const fixture = await render();
    (fixture.componentInstance as unknown as { form: { patchValue(value: object): void } }).form.patchValue({
      currentPassword: 'Dem0stracion!2026',
      newPassword: 'corta',
    });
    (fixture.componentInstance as unknown as { onSubmit(): void }).onSubmit();

    expect(api.changePassword).not.toHaveBeenCalled();
  });
});
