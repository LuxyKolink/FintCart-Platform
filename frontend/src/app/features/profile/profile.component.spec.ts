import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ProfileError, ProfileService } from './profile.service';
import { ProfileComponent } from './profile.component';

/**
 * T060 / FR-118: la pantalla de perfil declara su carga y su error, y **no limpia** el
 * formulario cuando el guardado falla (Edge Cases de 001: lo que el usuario escribió sigue
 * ahí para reintentar).
 */
describe('ProfileComponent', () => {
  let api: {
    getProfile: jasmine.Spy;
    updateProfile: jasmine.Spy;
  };

  const profile = {
    user_id: 'u1',
    email: 'mariana@correo.com',
    display_name: 'Mariana López',
    email_verified: true,
    account_status: 'active',
    preferences: { locale: 'es-CO', notif_inapp: 'true', notif_email: 'true' },
    roles: ['usuario'],
  };

  beforeEach(() => {
    api = {
      getProfile: jasmine.createSpy('getProfile').and.returnValue(of(profile)),
      updateProfile: jasmine.createSpy('updateProfile').and.returnValue(of({})),
    };
  });

  async function render(): Promise<ComponentFixture<ProfileComponent>> {
    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [provideRouter([]), { provide: ProfileService, useValue: api }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the account facts including the real state, not a hardcoded one', async () => {
    const host = (await render()).nativeElement as HTMLElement;

    expect(host.textContent).toContain('mariana@correo.com');
    expect(host.textContent).toContain('Activa');
    expect(host.textContent).toContain('Verificado');
  });

  it('does not translate an account state it does not know', async () => {
    api.getProfile.and.returnValue(of({ ...profile, account_status: 'pending_deletion' }));
    const host = (await render()).nativeElement as HTMLElement;

    // 002 añadirá estados nuevos; inventarles una traducción sería peor que enseñarlos.
    expect(host.textContent).toContain('pending_deletion');
  });

  it('shows an error state with retry and reloads on demand', async () => {
    api.getProfile.and.returnValue(throwError(() => new Error('boom')));
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('No pudimos cargar tu perfil');

    api.getProfile.and.returnValue(of(profile));
    (host.querySelector('fc-error-state button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.textContent).toContain('mariana@correo.com');
  });

  it('fills the form from the server preferences', async () => {
    const fixture = await render();
    const form = (fixture.componentInstance as unknown as { form: { getRawValue(): Record<string, unknown> } })
      .form;

    expect(form.getRawValue()).toEqual({
      displayName: 'Mariana López',
      locale: 'es-CO',
      notifInApp: true,
      notifEmail: true,
    });
  });

  it('keeps what the user typed when the save fails', async () => {
    api.updateProfile.and.returnValue(
      throwError(() => new ProfileError('offline', 'Parece que perdiste la conexión.')),
    );
    const fixture = await render();
    const internals = fixture.componentInstance as unknown as {
      form: { patchValue(value: object): void };
      onSubmit(): void;
    };

    internals.form.patchValue({ displayName: 'Nombre nuevo' });
    internals.onSubmit();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Parece que perdiste la conexión');
    expect(internals.form).toBeDefined();
    // El dato escrito sigue en el formulario.
    expect((fixture.componentInstance as unknown as { form: { getRawValue(): { displayName: string } } })
      .form.getRawValue().displayName).toBe('Nombre nuevo');
  });

  it('confirms the save, which is the whole point of the screen', async () => {
    const fixture = await render();
    const internals = fixture.componentInstance as unknown as { onSubmit(): void };
    internals.onSubmit();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Tus cambios se guardaron correctamente',
    );
  });
});
