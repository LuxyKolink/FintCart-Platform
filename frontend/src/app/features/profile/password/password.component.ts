import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';
import { ProfileError, ProfileService } from '../profile.service';

/** Flujo de cambio de contraseña (T150, FR-005). */
@Component({
  selector: 'fc-change-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './password.component.html',
})
export class PasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ProfileService);
  private readonly auth = inject(AuthService);

  protected readonly submitting = signal(false);
  protected readonly done = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    currentPassword: ['', [Validators.required]],
    // Misma política mínima que el registro (ver `register.component.ts`): un
    // valor más corto igual respondería del lado de Auth, pero solo después de
    // que el usuario ya haya llenado el formulario.
    newPassword: ['', [Validators.required, Validators.minLength(12)]],
  });

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const { currentPassword, newPassword } = this.form.getRawValue();
    this.api.changePassword({ current_password: currentPassword, new_password: newPassword }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.done.set(true);
        // El cambio de contraseña invalida las sesiones abiertas EN AUTH (ver
        // `auth-server/internal/server/password.go::ChangePassword`), incluida
        // la de esta pestaña: se limpia también la sesión local para que la UI
        // no siga mostrando una sesión que el borde ya no reconoce.
        this.auth.clearSession();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        // El formulario NO se limpia ante un error: una contraseña actual mal
        // tecleada no debe obligar a reescribir también la nueva.
        this.errorMessage.set(err instanceof ProfileError ? err.message : 'No pudimos cambiar tu contraseña.');
      },
    });
  }
}
