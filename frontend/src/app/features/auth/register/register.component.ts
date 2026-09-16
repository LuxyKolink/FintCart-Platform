import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ErrorBody } from '../../../core/auth/auth.types';
import { IdentityApiService } from '../../../core/auth/identity-api.service';
import { BannerComponent, ButtonComponent, CheckboxComponent, InputComponent } from '../../../shared/ui';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

@Component({
  selector: 'fc-register',
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
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly identity = inject(IdentityApiService);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly done = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    // 12 caracteres: mínimo real que exige Auth (ver quickstart.md); con menos, el
    // registro igual responde 202 y la saga falla después sin avisar al usuario.
    password: ['', [Validators.required, Validators.minLength(12)]],
    // Consentimiento de tratamiento de datos (FR-100, Ley 1581). Se presenta
    // explícito antes del envío pero NO se marca como requerido: el registro solo
    // acepta `email`, `password` y `display_name` (contrato del Gateway), y
    // bloquear el envío por un campo que el servidor no recibe rompería los cuatro
    // recorridos e2e, que se registran sin tocar esta casilla (N-13). Queda como
    // hallazgo para que la decisión —exigirlo en el contrato— sea consciente.
    consent: [false],
  });

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const { displayName, email, password } = this.form.getRawValue();
    this.identity.register({ email, password, display_name: displayName }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.done.set(true);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(
          err instanceof HttpErrorResponse && err.status === 409
            ? ((err.error as ErrorBody | undefined)?.message ?? 'Ese correo ya está registrado.')
            : 'No pudimos crear tu cuenta. Intenta de nuevo.',
        );
      },
    });
  }
}
