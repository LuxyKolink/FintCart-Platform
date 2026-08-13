import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';
import { ProfileError, ProfileService } from '../profile.service';

/** Fixed CTA phrase the user must retype to confirm the irreversible action. */
const CONFIRM_PHRASE = 'ELIMINAR MI CUENTA';

function matchesConfirmPhrase(control: AbstractControl<string>): ValidationErrors | null {
  return control.value === CONFIRM_PHRASE ? null : { mismatch: true };
}

/** Flujo de eliminación de cuenta con advertencia de irreversibilidad (T151, FR-030). */
@Component({
  selector: 'fc-delete-account',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './delete-account.component.html',
})
export class DeleteAccountComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ProfileService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly confirmPhrase = CONFIRM_PHRASE;
  protected readonly submitting = signal(false);
  protected readonly accepted = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // Escribir la frase EXACTA es la fricción deliberada: la Saga de
  // anonimización no tiene compensación (D-08) y esta pantalla es la única
  // barrera entre un clic accidental y una operación que nada puede deshacer.
  protected readonly form = this.fb.nonNullable.group({
    confirmation: ['', [Validators.required, matchesConfirmPhrase]],
  });

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    this.api.deleteAccount().subscribe({
      next: () => {
        this.submitting.set(false);
        this.accepted.set(true);
        // La saga es asíncrona (SLA ≤ 15 días hábiles, SC-011): la cuenta no
        // queda anonimizada al instante, pero no tiene sentido dejar la sesión
        // abierta sobre una solicitud de supresión ya aceptada.
        this.auth.clearSession();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(
          err instanceof ProfileError ? err.message : 'No pudimos procesar la solicitud de eliminación.',
        );
      },
    });
  }

  protected goToLogin(): void {
    void this.router.navigateByUrl('/iniciar-sesion');
  }
}
