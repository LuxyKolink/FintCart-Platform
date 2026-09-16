import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { LoginComponent } from './login.component';

/** Los miembros del componente son `protected`; la prueba los alcanza con corchetes. */
interface LoginInternals {
  form: {
    setValue(value: { email: string; password: string; remember: boolean }): void;
  };
  onSubmit(): void;
  errorMessage(): string | null;
  needsVerification(): boolean;
}

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginInternals;
  let auth: { login: jasmine.Spy };
  let router: Router;

  beforeEach(async () => {
    auth = { login: jasmine.createSpy('login').and.returnValue(of(undefined)) };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl');
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance as unknown as LoginInternals;
    fixture.detectChanges();
  });

  it('does not call the authorization server while the form is invalid', () => {
    component.onSubmit();

    expect(auth.login).not.toHaveBeenCalled();
  });

  it('sends the credentials through the OAuth2 + PKCE flow', () => {
    component.form.setValue({ email: 'mariana@correo.com', password: 'Dem0stracion!2026', remember: false });
    component.onSubmit();

    expect(auth.login).toHaveBeenCalledWith('mariana@correo.com', 'Dem0stracion!2026', false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/catalogo');
  });

  it('keeps the session only when «Recordarme» is checked', () => {
    component.form.setValue({ email: 'mariana@correo.com', password: 'Dem0stracion!2026', remember: true });
    component.onSubmit();

    expect(auth.login).toHaveBeenCalledWith('mariana@correo.com', 'Dem0stracion!2026', true);
  });

  it('tells the user their email is not verified instead of a generic failure', () => {
    auth.login.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { code: 'email_unverified' },
          }),
      ),
    );
    component.form.setValue({ email: 'mariana@correo.com', password: 'Dem0stracion!2026', remember: false });
    component.onSubmit();

    expect(component.needsVerification()).toBe(true);
    expect(component.errorMessage()).toContain('verificas tu correo');
  });
});
