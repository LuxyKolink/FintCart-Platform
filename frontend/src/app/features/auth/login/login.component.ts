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
  IconComponent,
  InputComponent,
} from '../../../shared/ui';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

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
    IconComponent,
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

  /**
   * Acceso federado (FR-099). No hay proveedor de identidad externo: el
   * Authorization Server de la plataforma ES el Gateway (`/oauth/authorize` +
   * `/oauth/token`, Authorization Code + PKCE), que es justo lo que ejecuta
   * `AuthService.login`. El botón no es decorativo —dispara el mismo flujo
   * real— pero tampoco inventa una federación que no existe: la carencia de un
   * IdP externo queda como hallazgo (FR-122), no se resuelve aquí.
   */
  protected onFederated(): void {
    this.onSubmit();
  }

  private handleError(err: unknown): void {
    if (!(err instanceof HttpErrorResponse)) {
      this.errorMessage.set('No pudimos iniciar sesión. Intenta de nuevo.');
      return;
    }
    const body = err.error as ErrorBody | undefined;
    if (err.status === 403 && body?.code === 'email_unverified') {
      this.needsVerification.set(true);
      this.errorMessage.set('Todavía no verificas tu correo. Revisa tu bandeja o pide un nuevo enlace.');
      return;
    }
    if (err.status === 401) {
      this.errorMessage.set('Correo o contraseña incorrectos.');
      return;
    }
    this.errorMessage.set('No pudimos iniciar sesión. Intenta de nuevo en unos minutos.');
  }
}
