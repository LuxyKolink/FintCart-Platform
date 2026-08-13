import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';
import { ErrorBody } from '../../../core/auth/auth.types';

@Component({
  selector: 'fc-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
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
  });

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.needsVerification.set(false);

    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
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
