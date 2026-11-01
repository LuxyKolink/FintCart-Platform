import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';
import { ErrorBody } from '../../../core/auth/auth.types';
import {
  BannerComponent,
  ButtonComponent,
  CheckboxComponent,
  InputComponent,
} from '../../../shared/ui';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

/**
 * Inicio de sesión.
 *
 * UNA SOLA ACCIÓN DE ACCESO. La pantalla llegó a tener dos botones que ejecutaban
 * el MISMO flujo —el primario y otro rotulado «OAuth2 · PKCE» bajo un separador
 * «o continúa con»—. Ese segundo botón presentaba al estudiante el nombre del
 * protocolo como si fuera un proveedor externo: no lo es. El Authorization Server
 * de la plataforma ES el Gateway (`/oauth/authorize` + `/oauth/token`, Authorization
 * Code + PKCE) y `AuthService.login` ya lo ejecuta; no hay IdP externo que ofrecer
 * (la carencia queda como hallazgo, FR-122, no se resuelve aquí). Un botón que
 * repite la acción y nombra el protocolo no es una alternativa: es ruido con
 * apariencia de elección.
 */
@Component({
  selector: 'fc-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AuthLayoutComponent,
    BannerComponent,
    ButtonComponent,
    CheckboxComponent,
    InputComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly needsVerification = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    // Desmarcada por defecto: sin tocarla, la sesión sigue viviendo en
    // `sessionStorage` como antes (FR-121). Marcarla es la mejora opt-in de
    // «mantener la sesión iniciada» (FR-099).
    remember: [false],
  });

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.needsVerification.set(false);

    const { email, password, remember } = this.form.getRawValue();
    this.auth.login(email, password, remember).subscribe({
      next: () => {
        this.submitting.set(false);
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/catalogo';
        void this.router.navigateByUrl(returnUrl);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.handleError(err);
      },
    });
  }

  private handleError(err: unknown): void {
    if (!(err instanceof HttpErrorResponse)) {
      this.errorMessage.set('No pudimos iniciar sesión. Intenta de nuevo.');
      return;
    }
    const body = err.error as ErrorBody | undefined;
    if (err.status === 403 && body?.code === 'email_unverified') {
      this.needsVerification.set(true);
      this.errorMessage.set(
        'Todavía no verificas tu correo. Revisa tu bandeja o pide un nuevo enlace.',
      );
      return;
    }
    if (err.status === 401) {
      this.errorMessage.set('Correo o contraseña incorrectos.');
      return;
    }
    this.errorMessage.set('No pudimos iniciar sesión. Intenta de nuevo en unos minutos.');
  }
}
