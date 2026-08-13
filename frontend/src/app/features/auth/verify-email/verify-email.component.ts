import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { IdentityApiService } from '../../../core/auth/identity-api.service';

type Status = 'checking' | 'no-link' | 'success' | 'expired';

@Component({
  selector: 'fc-verify-email',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly identity = inject(IdentityApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly status = signal<Status>('checking');
  protected readonly resent = signal(false);
  protected readonly resending = signal(false);
  protected readonly resendError = signal<string | null>(null);

  protected readonly resendForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    displayName: ['', [Validators.required]],
  });

  public ngOnInit(): void {
    // Nombres de query param fijados por el correo real (`templates.ts::verificationLink`):
    // `user_id` y `token` — NO `verification_token`, aunque ese sea el nombre del campo
    // en el cuerpo de `POST /auth/verify-email`.
    const userId = this.route.snapshot.queryParamMap.get('user_id');
    const token = this.route.snapshot.queryParamMap.get('token');

    if (userId === null || token === null) {
      this.status.set('no-link');
      return;
    }

    this.identity.verifyEmail({ user_id: userId, verification_token: token }).subscribe({
      next: () => this.status.set('success'),
      error: () => this.status.set('expired'),
    });
  }

  /**
   * El contrato no tiene un endpoint dedicado de reenvío (Edge Cases,
   * `spec.md`): la única vía disponible es volver a llamar `POST
   * /auth/register` con el mismo correo, que el Orquestador trata como
   * reintento — emite un nuevo token si la cuenta sigue `pending_verification`.
   */
  protected onResend(): void {
    if (this.resendForm.invalid || this.resending()) {
      this.resendForm.markAllAsTouched();
      return;
    }
    this.resending.set(true);
    this.resendError.set(null);

    const { email, password, displayName } = this.resendForm.getRawValue();
    this.identity.register({ email, password, display_name: displayName }).subscribe({
      next: () => {
        this.resending.set(false);
        this.resent.set(true);
      },
      error: (err: unknown) => {
        this.resending.set(false);
        this.resendError.set(
          err instanceof HttpErrorResponse && err.status === 409
            ? 'Ese correo ya está verificado. Inicia sesión directamente.'
            : 'No pudimos reenviar el correo. Intenta de nuevo en unos minutos.',
        );
      },
    });
  }
}
