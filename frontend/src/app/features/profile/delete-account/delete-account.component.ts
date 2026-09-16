import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import {
  BannerComponent,
  ButtonComponent,
  CardComponent,
  InputComponent,
  LinkButtonComponent,
} from '../../../shared/ui';
import { AuthService } from '../../../core/auth/auth.service';
import { ProfileError, ProfileService } from '../profile.service';

/** Fixed CTA phrase the user must retype to confirm the irreversible action. */
const CONFIRM_PHRASE = 'ELIMINAR MI CUENTA';

function matchesConfirmPhrase(control: AbstractControl<string>): ValidationErrors | null {
  return control.value === CONFIRM_PHRASE ? null : { mismatch: true };
}

/**
 * Flujo de eliminación de cuenta con advertencia de irreversibilidad (T151, FR-030; T059,
 * FR-112).
 *
 * SIN PERÍODO DE REVERSIÓN, Y SE DICE. FR-112 pide comunicar «la consecuencia de la
 * operación y su período de reversión», y el período de reversión es de 002: el estado
 * `pending_deletion` con 30 días de gracia y la reactivación posterior (FR-078/FR-079). Hoy
 * **no existe**: no hay migración de estado, ni endpoint de reactivación, ni purga. Anunciar
 * «tienes 30 días para recuperarla» sería la peor clase de mentira en esta pantalla —una
 * promesa de reversibilidad sobre una operación que anonimiza sin vuelta atrás—, así que la
 * advertencia dice lo que la plataforma hace hoy y el plazo queda reportado como pendiente
 * de 002 (FR-122, FR-123).
 */
@Component({
  selector: 'fc-delete-account',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    BannerComponent,
    ButtonComponent,
    CardComponent,
    InputComponent,
    LinkButtonComponent,
  ],
  templateUrl: './delete-account.component.html',
  styleUrl: './delete-account.component.css',
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
